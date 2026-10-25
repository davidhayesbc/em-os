import type { Commitment, NewCommitment } from "@emos/api-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { createCommitmentsRepo } from "./commitments.js";

const now = "2026-10-24T12:00:00.000Z";
let sequence = 0;
let db: ReturnType<typeof openDb>;

function addPerson(id: string): void {
  db.prepare(`INSERT INTO people
    (id, display_name, relationship, aliases, archived, occurred_at, captured_at, updated_at, retention_state)
    VALUES (?, ?, 'other', '[]', 0, ?, ?, ?, 'active')`).run(id, id, now, now, now);
}

function input(over: Partial<NewCommitment> = {}): NewCommitment {
  return {
    direction: "mine",
    status: "active",
    dropReason: null,
    urgency: null,
    priority: null,
    due: null,
    tags: [],
    createdBy: "user",
    ownerId: "per_owner",
    counterpartId: null,
    goalId: null,
    meetingId: null,
    title: "Synthetic commitment",
    notes: "",
    pinned: false,
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    ...over,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  sequence = 0;
  addPerson("per_owner");
  addPerson("per_other");
});
afterEach(() => db.close());

function repo() {
  return createCommitmentsRepo(db, {
    now: () => new Date(now),
    id: (prefix) => `${prefix}_${++sequence}`,
  });
}

describe("CommitmentsRepo", () => {
  it("each save appends exactly one audit row", () => {
    const r = repo();
    const c = r.create(input());
    const changed: Commitment = { ...c, pinned: true, updatedAt: now };
    r.save(changed, { action: "pin", actor: "user" });
    r.save({ ...changed, pinned: false }, { action: "unpin", actor: "user" });
    expect(r.audit(c.id).map((event) => event.action)).toEqual(["pin", "unpin"]);
  });

  it.each(["import", "system"] as const)(
    "prevents a %s actor from reactivating a terminal commitment",
    (actor) => {
      const r = repo();
      const done = r.create(input({ status: "done", completedAt: now }));

      expect(() =>
        r.save(
          { ...done, status: "active", completedAt: null, updatedAt: now },
          { action: "edit", actor },
        ),
      ).toThrowError("Only a user can reopen a terminal commitment");
      expect(r.get(done.id)).toMatchObject({ status: "done", completedAt: now });
      expect(r.audit(done.id)).toEqual([]);
    },
  );

  it("permits an audited user reopen of a terminal commitment", () => {
    const r = repo();
    const dropped = r.create(input({ status: "dropped", dropReason: "user" }));

    const reopened = r.save(
      { ...dropped, status: "active", dropReason: null, updatedAt: now },
      { action: "reopen", actor: "user" },
    );

    expect(reopened).toMatchObject({ status: "active", dropReason: null });
    expect(r.get(dropped.id)).toMatchObject({ status: "active", dropReason: null });
    expect(r.audit(dropped.id).map((event) => event.action)).toEqual(["reopen"]);
  });

  it("filters active commitments owed to me", () => {
    const r = repo();
    const wanted = r.create(input({ direction: "owed_to_me" }));
    r.create(input({ direction: "mine" }));
    r.create(input({ direction: "owed_to_me", status: "done", completedAt: now }));
    expect(r.list({ status: ["active"], direction: "owed_to_me" }).map((c) => c.id)).toEqual([
      wanted.id,
    ]);
  });
});
