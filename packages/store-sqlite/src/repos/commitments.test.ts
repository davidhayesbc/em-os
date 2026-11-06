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
    pinProvenance: null,
    ticketId: null,
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    confidence: null,
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
  it("create appends exactly one complete create audit row", () => {
    const r = repo();
    const c = r.create(input());

    const events = r.audit(c.id);
    expect(events).toEqual([
      expect.objectContaining({
        entity: "commitment",
        entityId: c.id,
        action: "create",
        actor: "user",
        at: now,
        diff: expect.objectContaining({
          id: { from: null, to: c.id },
          title: { from: null, to: c.title },
          status: { from: null, to: "active" },
        }),
      }),
    ]);
    const created = events[0];
    if (!created) throw new Error("Missing create audit event");
    expect(Object.keys(created.diff)).toHaveLength(Object.keys(c).length);
  });

  it("a failed create rolls back both the commitment and audit row", () => {
    const r = repo();

    expect(() => r.create(input(), ["src_missing"])).toThrow();
    expect(r.list({})).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) count FROM audit_events").get()).toEqual({ count: 0 });
  });

  it("each save appends exactly one audit row", () => {
    const r = repo();
    const c = r.create(input());
    const changed: Commitment = { ...c, pinned: true, updatedAt: now };
    r.save(changed, { action: "pin", actor: "user" });
    r.save({ ...changed, pinned: false }, { action: "unpin", actor: "user" });
    expect(r.audit(c.id).map((event) => event.action)).toEqual(["create", "pin", "unpin"]);
  });

  it.each([
    ["import", "done", "active"],
    ["system", "done", "active"],
    ["import", "done", "proposed"],
    ["system", "dropped", "snoozed"],
  ] as const)(
    "prevents a %s actor from moving a terminal %s commitment to %s",
    (actor, terminalStatus, attemptedStatus) => {
      const r = repo();
      const terminal = r.create(
        input({
          status: terminalStatus,
          completedAt: terminalStatus === "done" ? now : null,
          dropReason: terminalStatus === "dropped" ? "user" : null,
        }),
      );

      expect(() =>
        r.save(
          {
            ...terminal,
            status: attemptedStatus,
            completedAt: null,
            dropReason: null,
            snoozedUntil: attemptedStatus === "snoozed" ? now : null,
            updatedAt: now,
          },
          { action: "edit", actor },
        ),
      ).toThrowError("Only a user can reopen a terminal commitment");
      expect(r.get(terminal.id)).toMatchObject({
        status: terminalStatus,
        completedAt: terminalStatus === "done" ? now : null,
        dropReason: terminalStatus === "dropped" ? "user" : null,
      });
      expect(r.audit(terminal.id).map((event) => event.action)).toEqual(["create"]);
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
    expect(r.audit(dropped.id).map((event) => event.action)).toEqual(["create", "reopen"]);
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

  it.each([
    ["extractor", "system"],
    ["import", "import"],
    ["mcp", "mcp"],
  ] as const)("persists capture-time confidence for createdBy=%s", (createdBy, actor) => {
    const r = repo();
    const c = r.create(input({ createdBy, confidence: 0.75 }));
    expect(c.confidence).toBe(0.75);
    expect(r.get(c.id)).toMatchObject({ confidence: 0.75 });
    expect(r.audit(c.id)[0]).toMatchObject({ action: "create", actor });
  });

  it("forces user-created confidence to null", () => {
    const r = repo();
    const c = r.create(input({ createdBy: "user", confidence: 0.75 }));
    expect(c.confidence).toBeNull();
    expect(r.get(c.id)).toMatchObject({ confidence: null });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1, "not a number"] as const)(
    "normalizes invalid confidence %j to null",
    (confidence) => {
      const r = repo();
      const c = r.create(input({ createdBy: "import", confidence: confidence as number }));
      expect(c.confidence).toBeNull();
    },
  );

  it("preserves capture-time confidence and ignores edits that try to change it", () => {
    const r = repo();
    const c = r.create(input({ createdBy: "import", confidence: 0.6 }));
    const replayed = r.save(
      { ...c, title: "Updated title", updatedAt: now },
      { action: "edit", actor: "import" },
    );
    expect(replayed.confidence).toBe(0.6);
    expect(r.get(c.id)).toMatchObject({ confidence: 0.6 });
    // A user edit that tries to fabricate confidence is ignored.
    const edited = r.save(
      { ...replayed, title: "User edit", confidence: 0.99, updatedAt: now },
      { action: "edit", actor: "user" },
    );
    expect(edited.confidence).toBe(0.6);
    expect(r.get(c.id)).toMatchObject({ confidence: 0.6 });
  });

  it("user-created commitments have no ticket linkage or pin provenance", () => {
    const r = repo();
    const c = r.create(input({ pinProvenance: "user" as const, ticketId: "src_1" }));
    expect(c.pinProvenance).toBeNull();
    expect(c.ticketId).toBeNull();
    expect(r.get(c.id)?.pinProvenance).toBeNull();
    expect(r.get(c.id)?.ticketId).toBeNull();
  });

  it("capture sources normalize and store ticket linkage and pin provenance", () => {
    const r = repo();
    const fromImport = r.create(
      input({
        createdBy: "import",
        status: "proposed",
        pinProvenance: "system" as const,
        ticketId: "src_ticket_1",
      }),
    );
    expect(fromImport.pinProvenance).toBe("system");
    expect(fromImport.ticketId).toBe("src_ticket_1");

    const invalid = r.create(
      input({
        createdBy: "mcp",
        status: "proposed",
        pinProvenance: "automated" as unknown as "system",
        ticketId: "src_ticket_2",
      }),
    );
    expect(invalid.pinProvenance).toBeNull();
    expect(invalid.ticketId).toBe("src_ticket_2");
  });

  it("user pin action sets user provenance; unpin clears it", () => {
    const r = repo();
    const c = r.create(input());
    const pinned = r.save({ ...c, pinned: true, updatedAt: now }, { action: "pin", actor: "user" });
    expect(pinned.pinned).toBe(true);
    expect(pinned.pinProvenance).toBe("user");
    expect(r.get(c.id)?.pinProvenance).toBe("user");

    const unpinned = r.save(
      { ...pinned, pinned: false, updatedAt: now },
      { action: "unpin", actor: "user" },
    );
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.pinProvenance).toBeNull();
    expect(r.get(c.id)?.pinProvenance).toBeNull();
  });

  it("non-user saves cannot change pin provenance or ticket linkage", () => {
    const r = repo();
    const fromImport = r.create(
      input({
        createdBy: "import",
        status: "proposed",
        pinProvenance: "system" as const,
        ticketId: "src_ticket_1",
      }),
    );
    const edited = r.save(
      {
        ...fromImport,
        title: "Updated",
        pinProvenance: "user" as const,
        ticketId: "changed",
        updatedAt: now,
      },
      { action: "edit", actor: "import" },
    );
    expect(edited.pinProvenance).toBe("system");
    expect(edited.ticketId).toBe("src_ticket_1");
  });
});
