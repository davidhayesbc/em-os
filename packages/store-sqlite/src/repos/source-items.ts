import { randomUUID } from "node:crypto";
import { ApiError, type NewSourceItem, type SourceItem } from "@emos/api-contract";
import type { SourceItemsRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

interface Deps {
  now(): Date;
  id(prefix: string): string;
}
const defaults: Deps = { now: () => new Date(), id: (prefix) => `${prefix}_${randomUUID()}` };

type Row = Record<string, unknown>;
const str = (r: Row, key: string) => r[key] as string;
const nullable = (r: Row, key: string) => (r[key] === null ? null : (r[key] as string));
const parse = <T>(value: string | null): T | null =>
  value === null ? null : (JSON.parse(value) as T);

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    (error as { errcode?: unknown }).errcode === 2067
  );
}

function mapSourceItem(row: Row): SourceItem {
  return {
    id: str(row, "id"),
    connectorId: str(row, "connector_id"),
    externalId: str(row, "external_id"),
    kind: str(row, "kind") as SourceItem["kind"],
    origin: str(row, "origin") as SourceItem["origin"],
    url: nullable(row, "url"),
    authorIdentityId: nullable(row, "author_identity_id"),
    text: str(row, "text"),
    contentHash: str(row, "content_hash"),
    sensitivity: str(row, "sensitivity") as SourceItem["sensitivity"],
    sections: parse<SourceItem["sections"]>(nullable(row, "sections")),
    occurredAt: str(row, "occurred_at"),
    capturedAt: str(row, "captured_at"),
    updatedAt: str(row, "updated_at"),
    retentionState: str(row, "retention_state") as SourceItem["retentionState"],
  };
}

const SENSITIVITY_RANK: Record<SourceItem["sensitivity"], number> = {
  normal: 0,
  people_sensitive: 1,
  private: 2,
};

function higherSensitivity(
  a: SourceItem["sensitivity"],
  b: SourceItem["sensitivity"],
): SourceItem["sensitivity"] {
  return SENSITIVITY_RANK[a] >= SENSITIVITY_RANK[b] ? a : b;
}

/** Tombstone payload: a purged source item must never carry source content. */
function clearedPayload(): Pick<
  SourceItem,
  "text" | "contentHash" | "url" | "authorIdentityId" | "sections"
> {
  return {
    text: "",
    contentHash: "",
    url: null,
    authorIdentityId: null,
    sections: null,
  };
}

export function createSourceItemsRepo(db: Db, deps: Partial<Deps> = {}): SourceItemsRepo {
  const d = { ...defaults, ...deps };
  return {
    upsert(input: NewSourceItem) {
      // Explicit purged operations are intentionally unsupported at this phase. Reject them
      // atomically instead of writing a content-retaining purged row.
      if (input.retentionState === "purged") {
        throw new ApiError("invalid_input", "Explicit purged retention is not supported");
      }

      const at = toDbInstant(d.now());
      const value: SourceItem = {
        ...input,
        id: d.id("src"),
        occurredAt: input.occurredAt ? toDbInstant(input.occurredAt) : at,
        capturedAt: at,
        updatedAt: at,
        retentionState: input.retentionState ?? "active",
      };
      try {
        db.prepare(`INSERT INTO source_items
          (id, connector_id, external_id, kind, origin, url, author_identity_id, text, content_hash, sensitivity, sections, occurred_at, captured_at, updated_at, retention_state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          value.id,
          value.connectorId,
          value.externalId,
          value.kind,
          value.origin,
          value.url,
          value.authorIdentityId,
          value.text,
          value.contentHash,
          value.sensitivity,
          value.sections === null ? null : JSON.stringify(value.sections),
          value.occurredAt,
          value.capturedAt,
          value.updatedAt,
          value.retentionState,
        );
        return { item: value, created: true };
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        const existingRow = db
          .prepare("SELECT * FROM source_items WHERE connector_id = ? AND external_id = ?")
          .get<Row>(value.connectorId, value.externalId);
        if (!existingRow) throw error; // should not happen
        const existing = mapSourceItem(existingRow);

        if (existing.retentionState === "purged") {
          // Terminal tombstone: identity, date, kind and source are preserved; content is never
          // restored and the record can never leave purged through upsert. If a legacy row still
          // holds content, clear it now.
          const payload =
            existing.text === "" &&
            existing.contentHash === "" &&
            existing.url === null &&
            existing.authorIdentityId === null &&
            existing.sections === null
              ? {
                  text: existing.text,
                  contentHash: existing.contentHash,
                  url: existing.url,
                  authorIdentityId: existing.authorIdentityId,
                  sections: existing.sections,
                }
              : clearedPayload();
          const item: SourceItem = {
            ...existing,
            ...payload,
            retentionState: "purged",
            updatedAt: at,
          };
          db.prepare(`UPDATE source_items SET
            text = ?, content_hash = ?, url = ?, author_identity_id = ?, sections = ?,
            retention_state = ?, updated_at = ?
            WHERE id = ?`).run(
            item.text,
            item.contentHash,
            item.url,
            item.authorIdentityId,
            item.sections === null ? null : JSON.stringify(item.sections),
            item.retentionState,
            item.updatedAt,
            item.id,
          );
          return { item, created: false };
        }

        // Ordinary replay: never lower an existing source's sensitivity, but allow upgrades.
        const item: SourceItem = {
          ...existing,
          text: value.text,
          contentHash: value.contentHash,
          url: value.url,
          authorIdentityId: value.authorIdentityId,
          sensitivity: higherSensitivity(existing.sensitivity, value.sensitivity),
          sections: value.sections,
          // Preserve optional provenance when replay omits it; use defaults only for creation.
          occurredAt: input.occurredAt ? toDbInstant(input.occurredAt) : existing.occurredAt,
          retentionState: input.retentionState ?? existing.retentionState,
          updatedAt: at,
        };
        db.prepare(`UPDATE source_items SET
          text = ?, content_hash = ?, url = ?, author_identity_id = ?, sensitivity = ?, sections = ?,
          occurred_at = ?, retention_state = ?, updated_at = ?
          WHERE id = ?`).run(
          item.text,
          item.contentHash,
          item.url,
          item.authorIdentityId,
          item.sensitivity,
          item.sections === null ? null : JSON.stringify(item.sections),
          item.occurredAt,
          item.retentionState,
          item.updatedAt,
          item.id,
        );
        return { item, created: false };
      }
    },
    get(id) {
      const row = db.prepare("SELECT * FROM source_items WHERE id = ?").get<Row>(id);
      return row ? mapSourceItem(row) : null;
    },
    byIds(ids) {
      if (ids.length === 0) return [];
      return db
        .prepare(
          `SELECT * FROM source_items WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY occurred_at, id`,
        )
        .all<Row>(...ids)
        .map(mapSourceItem);
    },
  };
}
