import type { NewAccomplishment, NewGoal } from "@emos/api-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { createAccomplishmentsRepo } from "./accomplishments.js";
import { createGoalsRepo } from "./goals.js";

const now = "2026-10-24T12:00:00.000Z";
let db: ReturnType<typeof openDb>;
let sequence = 0;
const deps = () => ({
  now: () => new Date(now),
  id: (prefix: string) => `${prefix}_${++sequence}`,
});

beforeEach(() => {
  db = openDb(":memory:");
  sequence = 0;
  db.prepare(`INSERT INTO people
    (id, display_name, relationship, aliases, archived, occurred_at, captured_at, updated_at, retention_state)
    VALUES ('per_owner', 'Owner', 'other', '[]', 0, ?, ?, ?, 'active')`).run(now, now, now);
});
afterEach(() => db.close());

const audit = (entity: string, entityId: string) =>
  db
    .prepare(
      "SELECT entity, entity_id entityId, action, actor, diff FROM audit_events WHERE entity=? AND entity_id=? ORDER BY rowid",
    )
    .all<Record<string, unknown>>(entity, entityId)
    .map((row) => ({ ...row, diff: JSON.parse(row.diff as string) }));

describe("repository audit completeness", () => {
  it("audits goal create and update with complete diffs", () => {
    const repo = createGoalsRepo(db, deps());
    const input: NewGoal = {
      title: "Ship phase one",
      slug: "ship-phase-one",
      subjectPersonId: "per_owner",
      horizon: "quarter",
      kind: "project",
      status: "active",
      targetDate: null,
      sensitivity: "normal",
    };
    const goal = repo.create(input);
    repo.update(goal.id, { title: "Ship phase one safely" });

    const events = audit("goal", goal.id);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      entity: "goal",
      entityId: goal.id,
      action: "create",
      actor: "user",
    });
    const created = events[0];
    if (!created) throw new Error("Missing goal create audit event");
    expect(Object.keys(created.diff as object)).toHaveLength(Object.keys(goal).length);
    expect(events[1]).toMatchObject({
      action: "update",
      actor: "user",
      diff: { title: { from: "Ship phase one", to: "Ship phase one safely" } },
    });
  });

  it("audits accomplishment create and rolls back data and audit when linking fails", () => {
    const repo = createAccomplishmentsRepo(db, deps());
    const input: NewAccomplishment = {
      subjectPersonId: "per_owner",
      summary: "Shipped the release",
      impact: null,
      tags: ["delivery"],
      sourceItemIds: [],
      sensitivity: "normal",
      status: "accepted",
    };
    const accomplishment = repo.create(input);
    expect(audit("accomplishment", accomplishment.id)).toEqual([
      expect.objectContaining({
        entity: "accomplishment",
        entityId: accomplishment.id,
        action: "create",
        actor: "user",
      }),
    ]);

    expect(() => repo.create(input, ["src_missing"])).toThrow();
    expect(repo.list()).toHaveLength(1);
    expect(
      db.prepare("SELECT COUNT(*) count FROM audit_events WHERE entity='accomplishment'").get(),
    ).toEqual({ count: 1 });
  });
});
