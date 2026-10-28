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

  it("returns null for an unknown id", () => {
    expect(repo().get("src_missing")).toBeNull();
  });
});
