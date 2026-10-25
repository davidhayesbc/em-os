import { randomUUID } from "node:crypto";
import type { Accomplishment, NewAccomplishment } from "@emos/api-contract";
import type { AccomplishmentsRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

type Row = Record<string, unknown>;
interface Deps {
  now(): Date;
  id(prefix: string): string;
}
const defaults: Deps = { now: () => new Date(), id: (p) => `${p}_${randomUUID()}` };
function map(r: Row): Accomplishment {
  return {
    id: r.id as string,
    subjectPersonId: r.subject_person_id as string,
    summary: r.summary as string,
    impact: r.impact as string | null,
    tags: JSON.parse(r.tags as string),
    sourceItemIds: JSON.parse(r.source_ids as string),
    sensitivity: r.sensitivity as Accomplishment["sensitivity"],
    status: r.status as Accomplishment["status"],
    occurredAt: r.occurred_at as string,
    capturedAt: r.captured_at as string,
    updatedAt: r.updated_at as string,
    retentionState: r.retention_state as Accomplishment["retentionState"],
  };
}
export function createAccomplishmentsRepo(db: Db, deps: Partial<Deps> = {}): AccomplishmentsRepo {
  const d = { ...defaults, ...deps };
  return {
    create(a: NewAccomplishment, sourceIds: string[] = a.sourceItemIds) {
      const at = toDbInstant(d.now());
      const value: Accomplishment = {
        ...a,
        sourceItemIds: sourceIds,
        id: d.id("acc"),
        occurredAt: a.occurredAt ?? at,
        capturedAt: at,
        updatedAt: at,
        retentionState: a.retentionState ?? "active",
      };
      db.transaction(() => {
        db.prepare(
          "INSERT INTO accomplishments (id,subject_person_id,summary,impact,tags,sensitivity,status,occurred_at,captured_at,updated_at,retention_state) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          value.id,
          value.subjectPersonId,
          value.summary,
          value.impact,
          JSON.stringify(value.tags),
          value.sensitivity,
          value.status,
          value.occurredAt,
          value.capturedAt,
          value.updatedAt,
          value.retentionState,
        );
        const stmt = db.prepare(
          "INSERT INTO record_sources (entity,entity_id,source_item_id) VALUES ('accomplishment',?,?)",
        );
        for (const id of sourceIds) stmt.run(value.id, id);
      });
      return value;
    },
    list(f = {}) {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.subjectPersonId) {
        where.push("a.subject_person_id=?");
        vals.push(f.subjectPersonId);
      }
      if (f.from) {
        where.push("a.occurred_at>=?");
        vals.push(f.from);
      }
      if (f.to) {
        where.push("a.occurred_at<=?");
        vals.push(f.to);
      }
      return db
        .prepare(
          `SELECT a.*, COALESCE(json_group_array(rs.source_item_id) FILTER (WHERE rs.source_item_id IS NOT NULL),'[]') source_ids FROM accomplishments a LEFT JOIN record_sources rs ON rs.entity='accomplishment' AND rs.entity_id=a.id${where.length ? ` WHERE ${where.join(" AND ")}` : ""} GROUP BY a.id ORDER BY a.occurred_at,a.id`,
        )
        .all<Row>(...vals)
        .map(map);
    },
  };
}
