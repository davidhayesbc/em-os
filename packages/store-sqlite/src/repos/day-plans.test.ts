import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { dataLayout } from "../paths.js";
import { createDayPlansRepo } from "./day-plans.js";

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), "emos-day-plans-"));
}

describe("createDayPlansRepo", () => {
  it("returns null for an unknown date and stores/retrieves ids", () => {
    const dir = tmpDataDir();
    const db = openDb(dataLayout(dir).dbFile);
    try {
      const repo = createDayPlansRepo(db);
      expect(repo.get("2026-10-25")).toBeNull();

      repo.set("2026-10-25", ["a", "b", "c"]);
      expect(repo.get("2026-10-25")).toEqual(["a", "b", "c"]);
      expect(repo.get("2026-10-26")).toBeNull();

      repo.set("2026-10-25", ["x"]);
      expect(repo.get("2026-10-25")).toEqual(["x"]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
