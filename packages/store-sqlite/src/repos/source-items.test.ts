import { createHash } from "node:crypto";
import { ApiError, type NewSourceItem } from "@emos/api-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { createSourceItemsRepo } from "./source-items.js";

const now = "2026-10-25T12:00:00.000Z";
let db: ReturnType<typeof openDb>;
let sequence = 0;

beforeEach(() => {
  db = openDb(":memory:");
  sequence = 0;
});
afterEach(() => db.close());

const repo = () =>
  createSourceItemsRepo(db, {
    now: () => new Date(now),
    id: (prefix) => `${prefix}_${++sequence}`,
  });

/** Repository backed by a mutable injected clock, for no-sleep advancing-time tests. */
function repoWithMutableClock(initialIso: string) {
  let t = new Date(initialIso).getTime();
  return {
    repo: createSourceItemsRepo(db, {
      now: () => new Date(t),
      id: (prefix) => `${prefix}_${++sequence}`,
    }),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const newItem = (overrides: Partial<NewSourceItem> = {}): NewSourceItem => ({
  connectorId: "manual",
  externalId: `ext_${++sequence}`,
  kind: "note",
  origin: "manual",
  url: null,
  authorIdentityId: null,
  text: "Synthetic note text",
  contentHash: hash("Synthetic note text"),
  sensitivity: "normal",
  sections: null,
  ...overrides,
});

/** Directly materialise a purged tombstone for tests that need one. */
function makePurgedTombstone(
  r: ReturnType<typeof repo>,
  input: NewSourceItem,
  occurredAt: string,
): { id: string; occurredAt: string; capturedAt: string } {
  const created = r.upsert({ ...input, occurredAt }).item;
  db.prepare(
    `UPDATE source_items
     SET text = '', content_hash = '', url = NULL, author_identity_id = NULL, sections = NULL,
         retention_state = 'purged'
     WHERE id = ?`,
  ).run(created.id);
  return { id: created.id, occurredAt, capturedAt: created.capturedAt };
}

describe("SourceItemsRepo", () => {
  it("creates and retrieves a source item", () => {
    const r = repo();
    const item = r.upsert(newItem()).item;

    expect(r.get(item.id)).toEqual(item);
    expect(r.byIds([item.id])).toEqual([item]);
    expect(r.byIds([])).toEqual([]);
  });

  it("upserts idempotently on (connector_id, external_id)", () => {
    const r = repo();
    const first = r.upsert(newItem({ externalId: "shared" }));
    const second = r.upsert(
      newItem({ externalId: "shared", text: "Updated text", contentHash: hash("Updated text") }),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.item.id).toBe(first.item.id);
    expect(second.item.text).toBe("Updated text");
    expect(second.item.contentHash).toBe(hash("Updated text"));
    expect(second.item.capturedAt).toBe(first.item.capturedAt);
    expect(second.item.updatedAt).toBe(now);
  });

  it("independent connector keys do not collide", () => {
    const r = repo();
    const a = r.upsert(newItem({ connectorId: "cal-a", externalId: "evt-1" })).item;
    const b = r.upsert(newItem({ connectorId: "cal-b", externalId: "evt-1" })).item;

    expect(a.id).not.toBe(b.id);
    expect(r.get(a.id)?.connectorId).toBe("cal-a");
    expect(r.get(b.id)?.connectorId).toBe("cal-b");
  });

  it("preserves optional occurredAt and retentionState on replay", () => {
    const r = repo();
    const first = r.upsert(
      newItem({
        externalId: "retained",
        occurredAt: "2026-01-01T00:00:00.000Z",
        retentionState: "excluded",
      }),
    ).item;
    const second = r.upsert(newItem({ externalId: "retained", text: "Updated" })).item;

    expect(second.id).toBe(first.id);
    expect(second.occurredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(second.retentionState).toBe("excluded");
    expect(second.text).toBe("Updated");
    expect(second.updatedAt).toBe(now);
  });

  it("normalizes seconds-only and fractional instants", () => {
    const r = repo();
    const seconds = r.upsert(
      newItem({ externalId: "seconds", occurredAt: "2026-01-01T09:00:00Z" }),
    ).item;
    expect(seconds.occurredAt).toBe("2026-01-01T09:00:00.000Z");

    const fractional = r.upsert(
      newItem({ externalId: "fractional", occurredAt: "2026-01-01T09:00:00.123456Z" }),
    ).item;
    expect(fractional.occurredAt).toBe("2026-01-01T09:00:00.123Z");
  });

  it("rejects explicit purged retention on insert", () => {
    const r = repo();
    expect(() =>
      r.upsert(newItem({ externalId: "insert-purged", retentionState: "purged" })),
    ).toThrow(ApiError);
    expect(r.get("src_1")).toBeNull();
    expect(
      db.prepare("SELECT count(*) n FROM source_items WHERE external_id = ?").get("insert-purged"),
    ).toEqual({ n: 0 });
  });

  it("rejects active->purged transition and leaves the row active", () => {
    const r = repo();
    const active = r.upsert(newItem({ externalId: "active-to-purged", text: "Original" })).item;
    expect(() =>
      r.upsert(newItem({ externalId: "active-to-purged", retentionState: "purged" })),
    ).toThrow(ApiError);

    const persisted = r.get(active.id);
    expect(persisted).toEqual(active);
    expect(persisted?.retentionState).toBe("active");
    expect(persisted?.text).toBe("Original");
  });

  it("keeps a purged tombstone terminal and empty on replay", () => {
    const r = repo();
    const { id, occurredAt, capturedAt } = makePurgedTombstone(
      r,
      newItem({ externalId: "purged" }),
      "2026-01-01T00:00:00.000Z",
    );

    const replay = r.upsert(
      newItem({ externalId: "purged", text: "Resurrect attempt", sensitivity: "private" }),
    ).item;
    expect(replay.id).toBe(id);
    expect(replay.retentionState).toBe("purged");
    expect(replay.text).toBe("");
    expect(replay.contentHash).toBe("");
    expect(replay.url).toBeNull();
    expect(replay.authorIdentityId).toBeNull();
    expect(replay.sections).toBeNull();
    expect(replay.occurredAt).toBe(occurredAt);
    expect(replay.capturedAt).toBe(capturedAt);
    expect(replay.updatedAt).toBe(now);
    expect(replay.sensitivity).toBe("normal");
    expect(r.get(id)).toEqual(replay);
  });

  it("clears legacy content from a purged row on first replay", () => {
    const r = repo();
    const active = r.upsert(newItem({ externalId: "legacy-purged", text: "Original" })).item;
    // Simulate a legacy purged row that still carries content.
    db.prepare("UPDATE source_items SET retention_state = 'purged' WHERE id = ?").run(active.id);

    const replay = r.upsert(
      newItem({ externalId: "legacy-purged", text: "New content", sensitivity: "private" }),
    ).item;
    expect(replay.id).toBe(active.id);
    expect(replay.retentionState).toBe("purged");
    expect(replay.text).toBe("");
    expect(replay.contentHash).toBe("");
    expect(replay.sections).toBeNull();
    expect(replay.url).toBeNull();
    expect(replay.authorIdentityId).toBeNull();
    expect(r.get(active.id)).toEqual(replay);
  });

  it("purged->active/archived/excluded attempts do not leave purged", () => {
    const r = repo();
    const { id } = makePurgedTombstone(r, newItem({ externalId: "terminal" }), now);

    for (const retentionState of ["active", "archived", "excluded"] as const) {
      const attempt = r.upsert(
        newItem({ externalId: "terminal", text: `Try ${retentionState}`, retentionState }),
      ).item;
      expect(attempt.id).toBe(id);
      expect(attempt.retentionState).toBe("purged");
      expect(attempt.text).toBe("");
    }
  });

  it("advancing clock regression: capturedAt and occurredAt retained, updatedAt advances, retention and purged tombstone unchanged", () => {
    const { repo: r, advance } = repoWithMutableClock("2026-10-25T12:00:00.000Z");

    // Active row: provenance is retained and updatedAt moves forward.
    const activeFirst = r.upsert(
      newItem({
        externalId: "active-clock",
        occurredAt: "2025-06-01T00:00:00.000Z",
      }),
    ).item;
    advance(60_000);
    const activeReplay = r.upsert(
      newItem({ externalId: "active-clock", text: "Replayed active" }),
    ).item;
    expect(activeReplay.id).toBe(activeFirst.id);
    expect(activeReplay.occurredAt).toBe("2025-06-01T00:00:00.000Z");
    expect(activeReplay.capturedAt).toBe(activeFirst.capturedAt);
    expect(activeReplay.retentionState).toBe("active");
    expect(activeReplay.text).toBe("Replayed active");
    expect(activeReplay.updatedAt).not.toBe(activeFirst.updatedAt);
    expect(new Date(activeReplay.updatedAt).getTime()).toBeGreaterThan(
      new Date(activeFirst.updatedAt).getTime(),
    );

    // Archived row: retention state and provenance are preserved.
    const archivedFirst = r.upsert(
      newItem({
        externalId: "archived-clock",
        occurredAt: "2025-07-01T00:00:00.000Z",
        retentionState: "archived",
      }),
    ).item;
    advance(60_000);
    const archivedReplay = r.upsert(
      newItem({ externalId: "archived-clock", text: "Replayed archived" }),
    ).item;
    expect(archivedReplay.id).toBe(archivedFirst.id);
    expect(archivedReplay.occurredAt).toBe("2025-07-01T00:00:00.000Z");
    expect(archivedReplay.capturedAt).toBe(archivedFirst.capturedAt);
    expect(archivedReplay.retentionState).toBe("archived");
    expect(new Date(archivedReplay.updatedAt).getTime()).toBeGreaterThan(
      new Date(archivedFirst.updatedAt).getTime(),
    );

    // Excluded row: same contract.
    const excludedFirst = r.upsert(
      newItem({
        externalId: "excluded-clock",
        occurredAt: "2025-08-01T00:00:00.000Z",
        retentionState: "excluded",
      }),
    ).item;
    advance(60_000);
    const excludedReplay = r.upsert(
      newItem({ externalId: "excluded-clock", text: "Replayed excluded" }),
    ).item;
    expect(excludedReplay.id).toBe(excludedFirst.id);
    expect(excludedReplay.occurredAt).toBe("2025-08-01T00:00:00.000Z");
    expect(excludedReplay.capturedAt).toBe(excludedFirst.capturedAt);
    expect(excludedReplay.retentionState).toBe("excluded");
    expect(new Date(excludedReplay.updatedAt).getTime()).toBeGreaterThan(
      new Date(excludedFirst.updatedAt).getTime(),
    );

    // Purged tombstone stays terminal and empty, but its updatedAt still advances.
    const { id, occurredAt, capturedAt } = makePurgedTombstone(
      r,
      newItem({ externalId: "purged-clock" }),
      "2025-12-01T00:00:00.000Z",
    );
    advance(60_000);
    const purgedReplay = r.upsert(
      newItem({
        externalId: "purged-clock",
        text: "Resurrect attempt",
        sensitivity: "private",
      }),
    ).item;
    expect(purgedReplay.id).toBe(id);
    expect(purgedReplay.occurredAt).toBe(occurredAt);
    expect(purgedReplay.capturedAt).toBe(capturedAt);
    expect(purgedReplay.retentionState).toBe("purged");
    expect(purgedReplay.text).toBe("");
    expect(purgedReplay.contentHash).toBe("");
    expect(purgedReplay.url).toBeNull();
    expect(purgedReplay.authorIdentityId).toBeNull();
    expect(purgedReplay.sections).toBeNull();
    expect(purgedReplay.sensitivity).toBe("normal");
    expect(new Date(purgedReplay.updatedAt).getTime()).toBeGreaterThan(
      new Date(capturedAt).getTime(),
    );
    expect(r.get(id)).toEqual(purgedReplay);
  });

  it("never lowers sensitivity on replay", () => {
    const r = repo();
    const first = r.upsert(
      newItem({ externalId: "sens", text: "Original", sensitivity: "private" }),
    ).item;
    const replay = r.upsert(
      newItem({ externalId: "sens", text: "Updated", sensitivity: "normal" }),
    ).item;
    expect(replay.id).toBe(first.id);
    expect(replay.sensitivity).toBe("private");
    expect(replay.text).toBe("Updated");
  });

  it("permits sensitivity upgrades on replay", () => {
    const r = repo();
    const first = r.upsert(
      newItem({ externalId: "sens-up", text: "Original", sensitivity: "normal" }),
    ).item;
    const replay = r.upsert(
      newItem({ externalId: "sens-up", text: "Updated", sensitivity: "private" }),
    ).item;
    expect(replay.sensitivity).toBe("private");
    expect(r.get(first.id)?.sensitivity).toBe("private");
  });

  it("returns null for an unknown id", () => {
    expect(repo().get("src_missing")).toBeNull();
  });
});
