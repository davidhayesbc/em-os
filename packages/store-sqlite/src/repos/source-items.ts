import { randomUUID } from "node:crypto";
import { type NewSourceItem, type SourceItem } from "@emos/api-contract";
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

export function createSourceItemsRepo(db: Db, deps: Partial<Deps> = {}): SourceItemsRepo {
  const d = { ...defaults, ...deps };
  return {
    upsert(input: NewSourceItem) {
      const at = toDbInstant(d.now());
      const value: SourceItem = {
        ...input,
        id: d.id("src"),
        occurredAt: input.occurredAt ?? at,
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
        const existing = db
          .prepare("SELECT * FROM source_items WHERE connector_id = ? AND external_id = ?")
          .get<Row>(value.connectorId, value.externalId);
        if (!existing) throw error; // should not happen
        const item: SourceItem = {
          ...mapSourceItem(existing),
          text: value.text,
          contentHash: value.contentHash,
          url: value.url,
          authorIdentityId: value.authorIdentityId,
          sensitivity: value.sensitivity,
          sections: value.sections,
          occurredAt: value.occurredAt,
          retentionState: value.retentionState,
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
