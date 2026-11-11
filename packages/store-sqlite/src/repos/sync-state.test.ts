import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { createSyncStateRepo } from "./sync-state.js";

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => db.close());

describe("SyncStateRepo", () => {
  it("returns default state for an unknown connector", () => {
    const repo = createSyncStateRepo(db);
    expect(repo.get("missing")).toEqual({
      connectorId: "missing",
      cursor: null,
      state: "never",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      itemCount: 0,
    });
  });

  it("persists and reads sync state", () => {
    const repo = createSyncStateRepo(db);
    repo.set({
      connectorId: "cal",
      cursor: "page3",
      state: "ok",
      lastAttemptAt: "2026-10-20T12:00:00.000Z",
      lastSuccessAt: "2026-10-20T12:00:00.000Z",
      lastError: null,
      itemCount: 7,
    });

    const loaded = repo.get("cal");
    expect(loaded.cursor).toBe("page3");
    expect(loaded.state).toBe("ok");
    expect(loaded.itemCount).toBe(7);
  });
});
