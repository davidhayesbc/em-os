import { randomUUID } from "node:crypto";
import type { AuditEvent, Commitment, NewCommitment, SourceItem } from "@emos/api-contract";
import type { CommitmentsRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

interface Deps {
  now(): Date;
  id(prefix: string): string;
}
const defaults: Deps = { now: () => new Date(), id: (prefix) => `${prefix}_${randomUUID()}` };
const json = (value: unknown) => (value === null ? null : JSON.stringify(value));
const parse = <T>(value: string | null): T | null =>
  value === null ? null : (JSON.parse(value) as T);

type Row = Record<string, unknown>;
const str = (r: Row, key: string) => r[key] as string;
const nullable = (r: Row, key: string) => (r[key] === null ? null : (r[key] as string));

function commitment(r: Row): Commitment {
  return {
    id: str(r, "id"),
    direction: str(r, "direction") as Commitment["direction"],
    status: str(r, "status") as Commitment["status"],
    dropReason: nullable(r, "drop_reason") as Commitment["dropReason"],
    urgency: nullable(r, "urgency") as Commitment["urgency"],
    priority: r.priority === null ? null : Number(r.priority),
    due: parse<Commitment["due"]>(nullable(r, "due")),
    tags: parse<string[]>(str(r, "tags")) ?? [],
    createdBy: str(r, "created_by") as Commitment["createdBy"],
    ownerId: str(r, "owner_id"),
    counterpartId: nullable(r, "counterpart_id"),
    goalId: nullable(r, "goal_id"),
    meetingId: nullable(r, "meeting_id"),
    title: str(r, "title"),
    notes: str(r, "notes"),
    pinned: Number(r.pinned) === 1,
    effortMinutes: r.effort_minutes === null ? null : Number(r.effort_minutes),
    snoozedUntil: nullable(r, "snoozed_until"),
    completedAt: nullable(r, "completed_at"),
    recurrence: parse<Commitment["recurrence"]>(nullable(r, "recurrence")),
    seriesId: nullable(r, "series_id"),
    occurredAt: str(r, "occurred_at"),
    capturedAt: str(r, "captured_at"),
    updatedAt: str(r, "updated_at"),
    retentionState: str(r, "retention_state") as Commitment["retentionState"],
  };
}

function source(r: Row): SourceItem {
  return {
    id: str(r, "id"),
    connectorId: str(r, "connector_id"),
    externalId: str(r, "external_id"),
    kind: str(r, "kind") as SourceItem["kind"],
    origin: str(r, "origin") as SourceItem["origin"],
    url: nullable(r, "url"),
    authorIdentityId: nullable(r, "author_identity_id"),
    text: str(r, "text"),
    contentHash: str(r, "content_hash"),
    sensitivity: str(r, "sensitivity") as SourceItem["sensitivity"],
    sections: parse<SourceItem["sections"]>(nullable(r, "sections")),
    occurredAt: str(r, "occurred_at"),
    capturedAt: str(r, "captured_at"),
    updatedAt: str(r, "updated_at"),
    retentionState: str(r, "retention_state") as SourceItem["retentionState"],
  };
}

const fields: Array<[keyof Commitment, string]> = [
  ["direction", "direction"],
  ["status", "status"],
  ["dropReason", "drop_reason"],
  ["urgency", "urgency"],
  ["priority", "priority"],
  ["due", "due"],
  ["tags", "tags"],
  ["createdBy", "created_by"],
  ["ownerId", "owner_id"],
  ["counterpartId", "counterpart_id"],
  ["goalId", "goal_id"],
  ["meetingId", "meeting_id"],
  ["title", "title"],
  ["notes", "notes"],
  ["pinned", "pinned"],
  ["effortMinutes", "effort_minutes"],
  ["snoozedUntil", "snoozed_until"],
  ["completedAt", "completed_at"],
  ["recurrence", "recurrence"],
  ["seriesId", "series_id"],
  ["occurredAt", "occurred_at"],
  ["capturedAt", "captured_at"],
  ["updatedAt", "updated_at"],
  ["retentionState", "retention_state"],
];
function bound(key: keyof Commitment, value: unknown): unknown {
  if (key === "due" || key === "tags" || key === "recurrence") return json(value);
  return value;
}

export function createCommitmentsRepo(db: Db, deps: Partial<Deps> = {}): CommitmentsRepo {
  const d = { ...defaults, ...deps };
  return {
    create(c: NewCommitment, sourceIds: string[] = []): Commitment {
      const at = toDbInstant(d.now());
      const value: Commitment = {
        ...c,
        id: d.id("cmt"),
        occurredAt: c.occurredAt ?? at,
        capturedAt: at,
        updatedAt: at,
        retentionState: c.retentionState ?? "active",
      };
      db.transaction(() => {
        const columns = fields.map(([, column]) => column);
        db.prepare(
          `INSERT INTO commitments (id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`,
        ).run(value.id, ...fields.map(([key]) => bound(key, value[key])));
        const link = db.prepare(
          "INSERT INTO commitment_sources (commitment_id, source_item_id) VALUES (?, ?)",
        );
        for (const id of sourceIds) link.run(value.id, id);
      });
      return value;
    },
    save(c, audit): Commitment {
      const previous = this.get(c.id);
      if (!previous) throw new Error(`Unknown commitment ${c.id}`);
      const wasTerminal = previous.status === "done" || previous.status === "dropped";
      const leavesTerminal = c.status !== "done" && c.status !== "dropped";
      const isUserReopen =
        c.status === "active" && audit.actor === "user" && audit.action === "reopen";
      if (wasTerminal && leavesTerminal && !isUserReopen) {
        throw new Error("Only a user can reopen a terminal commitment");
      }
      const diff: AuditEvent["diff"] = {};
      for (const [key] of fields)
        if (JSON.stringify(previous[key]) !== JSON.stringify(c[key])) {
          diff[key] = { from: previous[key] ?? null, to: c[key] ?? null };
        }
      db.transaction(() => {
        db.prepare(
          `UPDATE commitments SET ${fields.map(([, column]) => `${column} = ?`).join(", ")} WHERE id = ?`,
        ).run(...fields.map(([key]) => bound(key, c[key])), c.id);
        db.prepare(
          "INSERT INTO audit_events (id, entity, entity_id, action, actor, at, note, diff) VALUES (?, 'commitment', ?, ?, ?, ?, ?, ?)",
        ).run(
          d.id("mcl"),
          c.id,
          audit.action,
          audit.actor,
          c.updatedAt,
          audit.note ?? null,
          JSON.stringify(diff),
        );
      });
      return c;
    },
    get(id) {
      const row = db.prepare("SELECT * FROM commitments WHERE id = ?").get<Row>(id);
      return row ? commitment(row) : null;
    },
    audit(id) {
      return db
        .prepare(
          "SELECT * FROM audit_events WHERE entity = 'commitment' AND entity_id = ? ORDER BY at, rowid",
        )
        .all<Row>(id)
        .map((r) => ({
          id: str(r, "id"),
          entity: str(r, "entity"),
          entityId: str(r, "entity_id"),
          action: str(r, "action"),
          actor: str(r, "actor") as AuditEvent["actor"],
          at: str(r, "at"),
          note: nullable(r, "note"),
          diff: parse<AuditEvent["diff"]>(str(r, "diff")) ?? {},
        }));
    },
    list(f) {
      const clauses: string[] = [];
      const values: unknown[] = [];
      if (f.status?.length) {
        clauses.push(`status IN (${f.status.map(() => "?").join(",")})`);
        values.push(...f.status);
      }
      for (const [key, column] of [
        ["direction", "direction"],
        ["counterpartId", "counterpart_id"],
        ["meetingId", "meeting_id"],
        ["goalId", "goal_id"],
      ] as const)
        if (f[key] !== undefined) {
          clauses.push(`${column} = ?`);
          values.push(f[key]);
        }
      if (f.createdBy?.length) {
        clauses.push(`created_by IN (${f.createdBy.map(() => "?").join(",")})`);
        values.push(...f.createdBy);
      }
      if (f.dueOnOrBefore) {
        clauses.push("due_date <= ?");
        values.push(f.dueOnOrBefore);
      }
      return db
        .prepare(
          `SELECT * FROM commitments${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY captured_at, id`,
        )
        .all<Row>(...values)
        .map(commitment);
    },
    sources(id) {
      return db
        .prepare(
          "SELECT s.* FROM source_items s JOIN commitment_sources cs ON cs.source_item_id=s.id WHERE cs.commitment_id=? ORDER BY s.occurred_at,s.id",
        )
        .all<Row>(id)
        .map(source);
    },
  };
}
