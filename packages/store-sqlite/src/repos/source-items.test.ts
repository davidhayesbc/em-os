import { createHash } from "node:crypto";
import type { NewSourceItem } from "@emos/api-contract";
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

  it("does not resurrect purged tombstone content", () => {
    const r = repo();
    const _first = r.upsert(newItem({ externalId: "purged", text: "Original" })).item;
    const purged = r.upsert(
      newItem({ externalId: "purged", text: "Still purged", retentionState: "purged" }),
    ).item;
    expect(purged.retentionState).toBe("purged");
    expect(purged.text).toBe("Still purged");

    // Ordinary replay without explicit retentionState must keep the tombstone.
    const replay = r.upsert(newItem({ externalId: "purged", text: "Resurrect attempt" })).item;
    expect(replay.retentionState).toBe("purged");
    expect(replay.text).toBe("Still purged");
    expect(replay.updatedAt).toBe(now);
  });

  it("advancing clock regression: historical, archived, excluded and purged rows keep provenance", () => {
    const r = repo();
    const _historical = r.upsert(
      newItem({
        externalId: "hist",
        occurredAt: "2025-06-01T00:00:00.000Z",
        retentionState: "archived",
      }),
    ).item;
    const replayed = r.upsert(newItem({ externalId: "hist", text: "Replayed" })).item;
    expect(replayed.occurredAt).toBe("2025-06-01T00:00:00.000Z");
    expect(replayed.retentionState).toBe("archived");
    expect(replayed.text).toBe("Replayed");

    const _excluded = r.upsert(
      newItem({
        externalId: "excluded",
        occurredAt: "2026-01-01T00:00:00.000Z",
        retentionState: "excluded",
      }),
    ).item;
    const excludedReplay = r.upsert(newItem({ externalId: "excluded" })).item;
    expect(excludedReplay.occurredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(excludedReplay.retentionState).toBe("excluded");

    const purged = r.upsert(
      newItem({ externalId: "purged-clock", text: "Tombstone", retentionState: "purged" }),
    ).item;
    const purgedReplay = r.upsert(
      newItem({ externalId: "purged-clock", text: "New content" }),
    ).item;
    expect(purgedReplay.occurredAt).toBe(purged.occurredAt);
    expect(purgedReplay.retentionState).toBe("purged");
    expect(purgedReplay.text).toBe("Tombstone");
  });

  it("returns null for an unknown id", () => {
    expect(repo().get("src_missing")).toBeNull();
  });
});
