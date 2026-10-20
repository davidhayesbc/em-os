import { join, posix, win32 } from "node:path";

/**
 * The per-user EM OS data directory (ADR 0002, Global Constraints):
 * - `EMOS_DATA_DIR`, when set and non-empty, wins on every platform (tests, dev, portable setups);
 * - macOS: `~/Library/Application Support/EM OS`;
 * - Windows: `%LOCALAPPDATA%\EM OS` (falling back to `<home>\AppData\Local`);
 * - anything else (Linux, dev only): `${XDG_DATA_HOME:-~/.local/share}/em-os`.
 *
 * Pure: the path flavour follows `platform`, not the host, so it is testable on any OS.
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homedir: string,
): string {
  const override = env.EMOS_DATA_DIR;
  if (override) return override;
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(homedir, "AppData", "Local");
    return win32.join(local, "EM OS");
  }
  if (platform === "darwin") {
    return posix.join(homedir, "Library", "Application Support", "EM OS");
  }
  // The XDG Base Directory spec says relative values must be ignored.
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(homedir, ".local", "share");
  return posix.join(base, "em-os");
}

/** Windows-style when it has a drive letter / UNC prefix or any backslash; POSIX otherwise. */
function pathFlavour(dir: string): typeof posix {
  return /^[A-Za-z]:/.test(dir) || dir.includes("\\") ? win32 : posix;
}

/**
 * Throws if `dir` or any of its parents contains a `.git` entry (a directory, or the `.git`
 * file used by worktrees and submodules). EM OS data must never land in a working tree,
 * where it could be committed. `exists` is injected so this stays pure and testable.
 */
export function assertNotInGitCheckout(dir: string, exists: (p: string) => boolean): void {
  const path = pathFlavour(dir);
  let current = path.resolve(dir);
  for (;;) {
    if (exists(path.join(current, ".git"))) {
      throw new Error(`EM OS data directory is inside a git checkout: ${dir}`);
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Where things live inside the data directory. */
export interface DataLayout {
  dataDir: string;
  /** The SQLite database: `<dataDir>/db/emos.db` (WAL/SHM files sit beside it). */
  dbFile: string;
  /** Pre-migration (`pre-<migration>.db`) and daily (`daily-YYYY-MM-DD.db`) backups. */
  backupsDir: string;
  /** Runtime files: `service.json`, `token`, `service.lock` (P0-11). */
  runDir: string;
  /** User configuration, e.g. `presets/*.yaml`, `plugins.json`. */
  configDir: string;
  logsDir: string;
}

export function dataLayout(dataDir: string): DataLayout {
  return {
    dataDir,
    dbFile: join(dataDir, "db", "emos.db"),
    backupsDir: join(dataDir, "backups"),
    runDir: join(dataDir, "run"),
    configDir: join(dataDir, "config"),
    logsDir: join(dataDir, "logs"),
  };
}
