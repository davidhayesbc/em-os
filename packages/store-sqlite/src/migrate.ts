import type { Db } from "./driver.js";
import { type Migration, migrations as registry } from "./migrations/index.js";

export type { Migration } from "./migrations/index.js";

function assertUniqueNames(list: readonly Migration[]): void {
  const seen = new Set<string>();
  for (const m of list) {
    if (seen.has(m.name)) throw new Error(`Duplicate migration name in registry: ${m.name}`);
    seen.add(m.name);
  }
}

function appliedNames(db: Db): string[] {
  const table = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("schema_migrations");
  if (!table) return [];
  return db
    .prepare("SELECT name FROM schema_migrations ORDER BY rowid")
    .all<{ name: string }>()
    .map((r) => r.name);
}

/**
 * Migrations in `list` that `db` has not applied yet, in registry order. Throws if the database
 * has applied a migration that `list` does not contain: it was written by a newer EM OS, and
 * migrations are forward-only.
 */
export function pendingMigrations(db: Db, list: readonly Migration[] = registry): Migration[] {
  assertUniqueNames(list);
  const applied = appliedNames(db);
  const known = new Set(list.map((m) => m.name));
  const unknown = applied.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `Database has migrations this version of EM OS does not know (written by a newer version?): ${unknown.join(", ")}`,
    );
  }
  const done = new Set(applied);
  return list.filter((m) => !done.has(m.name));
}

/**
 * Applies pending migrations in registry order, one transaction per migration, recording each
 * name in `schema_migrations` (created by 0001). Must not be called inside a transaction.
 *
 * Foreign-key enforcement is switched off while a migration runs (it cannot change inside a
 * transaction), so the standard SQLite table-rebuild recipe (create new, copy, drop old,
 * rename) never cascades deletes. `PRAGMA foreign_key_check` must come back empty before the
 * migration commits; otherwise it rolls back. Enforcement is restored afterwards either way.
 */
export function migrate(db: Db, list: readonly Migration[] = registry): { applied: string[] } {
  const pending = pendingMigrations(db, list);
  const applied: string[] = [];
  if (pending.length === 0) return { applied };
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    // The pragma is a silent no-op inside a transaction, and then a table rebuild would
    // cascade-delete child rows. Refuse instead.
    const fk = db.prepare("PRAGMA foreign_keys").get<{ foreign_keys: number }>();
    if (fk?.foreign_keys !== 0) {
      throw new Error("migrate() must not run inside an open transaction");
    }
    for (const m of pending) {
      const ran = db.transaction(() => {
        // Re-check under the write lock: another process may have applied it meanwhile.
        if (appliedNames(db).includes(m.name)) return false;
        db.exec(m.sql);
        const violations = db.prepare("PRAGMA foreign_key_check").all<{ table: string }>();
        if (violations.length > 0) {
          const tables = [...new Set(violations.map((v) => v.table))].join(", ");
          throw new Error(`Migration ${m.name} leaves foreign key violations in: ${tables}`);
        }
        db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
          m.name,
          new Date().toISOString(),
        );
        return true;
      });
      if (ran) applied.push(m.name);
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  return { applied };
}
