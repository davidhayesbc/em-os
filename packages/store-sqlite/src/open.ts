import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Db, openSqlite } from "./driver.js";
import { type Migration, migrate, pendingMigrations } from "./migrate.js";
import { migrations as registry } from "./migrations/index.js";

export interface OpenDbOptions {
  /**
   * Where pre-migration backups go. Defaults to `backups/` beside the db file's directory,
   * i.e. `<dataDir>/backups` for the standard `<dataDir>/db/emos.db` (see `dataLayout`).
   */
  backupsDir?: string;
  /** Migration list to apply. Defaults to the registry; tests pass extra entries. */
  migrations?: readonly Migration[];
}

const POSIX = process.platform !== "win32";

/**
 * Opens the EM OS database at `file`, creating its directory (mode 0o700 on POSIX) and the file
 * if needed. Sets WAL, foreign_keys=ON and busy_timeout=5000, then migrates.
 *
 * If the file already held a database with pending migrations, a snapshot is written first to
 * `<backupsDir>/pre-<first-pending-name>.db`, replacing one left by an earlier attempt.
 *
 * Callers are responsible for `assertNotInGitCheckout` on the data dir (the service does it).
 */
export function openDb(file: string, opts: OpenDbOptions = {}): Db {
  const list = opts.migrations ?? registry;
  const backupsDir = opts.backupsDir ?? join(dirname(dirname(file)), "backups");
  const existed = existsSync(file) && statSync(file).size > 0;
  mkdirSync(dirname(file), { recursive: true, ...(POSIX ? { mode: 0o700 } : {}) });

  const db = openSqlite(file);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    if (existed) {
      const [first] = pendingMigrations(db, list);
      if (first) backupBeforeMigrating(db, join(backupsDir, `pre-${first.name}.db`));
    }
    migrate(db, list);
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}

/**
 * `openDb` is synchronous, so this uses `VACUUM INTO` (a consistent, synchronous snapshot)
 * rather than the async `Db.backup`. ADR 0002 lists it as the backup fallback.
 */
function backupBeforeMigrating(db: Db, target: string): void {
  mkdirSync(dirname(target), { recursive: true, ...(POSIX ? { mode: 0o700 } : {}) });
  // Always take a fresh snapshot: a `pre-<name>.db` left by an earlier failed attempt predates
  // everything written since. VACUUM INTO needs a new file, so write a temp file and rename it
  // over the target; a crash midway leaves the old backup intact.
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    db.prepare("VACUUM INTO ?").run(tmp);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
