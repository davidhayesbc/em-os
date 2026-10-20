// Adapter for SQLITE_DRIVER = node:sqlite (ADR 0002 "Spike result"). This is the only module
// that imports the driver; everything else talks to the `Db` interface, so a swap to
// better-sqlite3 stays local to this file.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { backup, DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

export interface Statement {
  run(...params: unknown[]): { changes: number };
  get<T>(...params: unknown[]): T | undefined;
  all<T>(...params: unknown[]): T[];
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  /**
   * Runs `fn` atomically. The outermost call issues `BEGIN IMMEDIATE` (so a writer never fails
   * mid-transaction on a lock upgrade); nested calls use savepoints, so an inner failure rolls
   * back only the inner work. Errors are rethrown after the rollback. `fn` must be synchronous.
   */
  transaction<T>(fn: () => T): T;
  /** Consistent online snapshot to `toPath` (the parent directory is created). */
  backup(toPath: string): Promise<void>;
  close(): void;
}

/**
 * Bound parameters: booleans become 0/1 (node:sqlite refuses to bind them). Everything else
 * is passed through, so `undefined` and objects still fail loudly instead of being coerced.
 */
function bind(params: unknown[]): SQLInputValue[] {
  return params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p)) as SQLInputValue[];
}

function wrap(stmt: StatementSync): Statement {
  return {
    run: (...params) => ({ changes: Number(stmt.run(...bind(params)).changes) }),
    get: <T>(...params: unknown[]) => stmt.get(...bind(params)) as T | undefined,
    all: <T>(...params: unknown[]) => stmt.all(...bind(params)) as T[],
  };
}

function isThenable(v: unknown): boolean {
  return (
    v !== null &&
    (typeof v === "object" || typeof v === "function") &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

/** Opens (creating if needed) the SQLite file at `file`. No pragmas or migrations: see `openDb`. */
export function openSqlite(file: string): Db {
  return wrapDatabase(new DatabaseSync(file));
}

/** Runs a rollback statement without letting its failure replace the error that caused it. */
function rollbackQuietly(raw: DatabaseSync, sql: string): void {
  try {
    if (raw.isTransaction) raw.exec(sql);
  } catch {
    // The original error is more useful; SQLite rolls back on close if the rollback failed.
  }
}

/** Adapts an open `DatabaseSync` handle to `Db`. Exported for tests that need a custom handle. */
export function wrapDatabase(raw: DatabaseSync): Db {
  let depth = 0;

  const runBody = <T>(fn: () => T): T => {
    const result = fn();
    if (isThenable(result)) {
      throw new TypeError("Db.transaction callback must be synchronous (it returned a Promise)");
    }
    return result;
  };

  return {
    exec: (sql) => raw.exec(sql),
    prepare: (sql) => wrap(raw.prepare(sql)),
    transaction<T>(fn: () => T): T {
      if (!raw.isTransaction) {
        raw.exec("BEGIN IMMEDIATE");
        depth = 0;
        try {
          const result = runBody(fn);
          raw.exec("COMMIT");
          return result;
        } catch (e) {
          // SQLite may already have rolled back on its own (e.g. SQLITE_FULL).
          rollbackQuietly(raw, "ROLLBACK");
          throw e;
        }
      }
      const name = `emos_sp_${++depth}`;
      raw.exec(`SAVEPOINT ${name}`);
      try {
        const result = runBody(fn);
        raw.exec(`RELEASE ${name}`);
        return result;
      } catch (e) {
        rollbackQuietly(raw, `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw e;
      } finally {
        depth--;
      }
    },
    async backup(toPath) {
      mkdirSync(dirname(toPath), { recursive: true, mode: 0o700 });
      await backup(raw, toPath);
    },
    close: () => raw.close(),
  };
}
