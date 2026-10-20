// Test-only helpers: temp data dirs under os.tmpdir(), never inside the repo.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "./driver.js";

const dirs: string[] = [];
const open: Db[] = [];

/** A fresh temp data dir (with a space and Unicode in its name, to exercise odd paths). */
export function tmpDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "emos store zoë-"));
  dirs.push(dir);
  return dir;
}

/** `<fresh data dir>/db/emos.db` (the file does not exist yet). */
export function tmp(): string {
  return join(tmpDataDir(), "db", "emos.db");
}

/** Register a Db so `cleanup()` closes it before deleting its directory (Windows needs this). */
export function track<T extends Db>(db: T): T {
  open.push(db);
  return db;
}

export function cleanup(): void {
  for (const db of open.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const T0 = "2026-10-20T16:00:00.000Z";

/** The four time/retention columns every dated table has, as a column list + values. */
export const DATED_COLS = "occurred_at, captured_at, updated_at, retention_state";
export const DATED_VALS = [T0, T0, T0, "active"] as const;
