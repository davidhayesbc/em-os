import { randomUUID } from "node:crypto";
import { ApiError, type Goal, type NewGoal } from "@emos/api-contract";
import type { GoalsRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

type Row = Record<string, unknown>;
interface Deps {
  now(): Date;
  id(prefix: string): string;
}
const defaults: Deps = { now: () => new Date(), id: (p) => `${p}_${randomUUID()}` };
function map(r: Row): Goal {
  return {
    id: r.id as string,
    title: r.title as string,
    slug: r.slug as string | null,
    subjectPersonId: r.subject_person_id as string,
    horizon: r.horizon as Goal["horizon"],
    kind: r.kind as Goal["kind"],
    status: r.status as Goal["status"],
    targetDate: r.target_date as string | null,
    sensitivity: r.sensitivity as Goal["sensitivity"],
    occurredAt: r.occurred_at as string,
    capturedAt: r.captured_at as string,
    updatedAt: r.updated_at as string,
    retentionState: r.retention_state as Goal["retentionState"],
  };
}

export function createGoalsRepo(db: Db, deps: Partial<Deps> = {}): GoalsRepo {
  const d = { ...defaults, ...deps };
  return {
    create(g: NewGoal) {
      const at = toDbInstant(d.now());
      const value: Goal = {
        ...g,
        id: d.id("gol"),
        occurredAt: g.occurredAt ?? at,
        capturedAt: at,
        updatedAt: at,
        retentionState: g.retentionState ?? "active",
      };
      db.prepare(
        "INSERT INTO goals (id,title,slug,subject_person_id,horizon,kind,status,target_date,sensitivity,occurred_at,captured_at,updated_at,retention_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        value.id,
        value.title,
        value.slug,
        value.subjectPersonId,
        value.horizon,
        value.kind,
        value.status,
        value.targetDate,
        value.sensitivity,
        value.occurredAt,
        value.capturedAt,
        value.updatedAt,
        value.retentionState,
      );
      return value;
    },
    update(id, patch) {
      const old = this.get(id);
      if (!old) throw new ApiError("not_found", "Goal not found");
      const value = { ...old, ...patch, updatedAt: toDbInstant(d.now()) };
      db.prepare(
        "UPDATE goals SET title=?,slug=?,subject_person_id=?,horizon=?,kind=?,status=?,target_date=?,sensitivity=?,occurred_at=?,updated_at=?,retention_state=? WHERE id=?",
      ).run(
        value.title,
        value.slug,
        value.subjectPersonId,
        value.horizon,
        value.kind,
        value.status,
        value.targetDate,
        value.sensitivity,
        value.occurredAt,
        value.updatedAt,
        value.retentionState,
        id,
      );
      return value;
    },
    get(id) {
      const row = db.prepare("SELECT * FROM goals WHERE id=?").get<Row>(id);
      return row ? map(row) : null;
    },
    list(f = {}) {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.status?.length) {
        where.push(`status IN (${f.status.map(() => "?").join(",")})`);
        vals.push(...f.status);
      }
      if (f.subjectPersonId) {
        where.push("subject_person_id=?");
        vals.push(f.subjectPersonId);
      }
      return db
        .prepare(
          `SELECT * FROM goals${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY captured_at,id`,
        )
        .all<Row>(...vals)
        .map(map);
    },
  };
}
