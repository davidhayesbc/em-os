// Single-instance lock: `run/service.lock` holds the owner's pid.
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";

export class AlreadyRunningError extends Error {
  readonly pid: number;
  constructor(pid: number) {
    super(`EM OS service already running (pid ${pid})`);
    this.name = "AlreadyRunningError";
    this.pid = pid;
  }
}

/**
 * `process.kill(pid, 0)` probe: ESRCH = no such process (dead); EPERM = exists but belongs to
 * someone else (alive). Note: a recycled pid of an unrelated process also reads as alive.
 */
export function isPidAlive(
  pid: number,
  kill: (pid: number, signal: number) => unknown = process.kill.bind(process),
): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface Lock {
  readonly path: string;
  /** Removes the lock file if it still holds our pid. Idempotent. */
  release(): void;
}

export interface AcquireLockOptions {
  pid?: number;
  isAlive?: (pid: number) => boolean;
  /**
   * How long an unparseable lock file is given to become a pid (another instance may be between
   * create and write) before it is treated as stale.
   */
  partialWriteGraceMs?: number;
}

function code(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException).code;
}

function readPid(path: string): number | null | "missing" {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (code(e) === "ENOENT") return "missing";
    throw e;
  }
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

function tryCreate(path: string, pid: number): boolean {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (e) {
    if (code(e) === "EEXIST") return false;
    throw e;
  }
  try {
    writeSync(fd, `${pid}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Takes the lock at `path` (created exclusively with `wx`). If it exists and its pid is alive,
 * rejects with {@link AlreadyRunningError} ("already running"). A lock whose pid is dead (or
 * whose contents stay unparseable past the grace period) is stale and is reclaimed.
 *
 * Reclaiming renames the stale file aside rather than unlinking it: rename is atomic, so of two
 * processes reclaiming the same stale lock only one moves it, and a reclaimer that raced and
 * moved a *fresh* lock instead puts it back and retries.
 */
export async function acquireLock(path: string, opts: AcquireLockOptions = {}): Promise<Lock> {
  const pid = opts.pid ?? process.pid;
  const isAlive = opts.isAlive ?? ((p: number) => isPidAlive(p));
  const graceMs = opts.partialWriteGraceMs ?? 1000;

  for (let attempt = 0; attempt < 10; attempt++) {
    if (tryCreate(path, pid)) return makeLock(path, pid);

    let owner = readPid(path);
    if (owner === null) {
      await sleep(graceMs); // maybe mid-write; look again
      owner = readPid(path);
    }
    if (owner === "missing") continue; // released meanwhile; retry the create
    if (owner !== null && isAlive(owner)) throw new AlreadyRunningError(owner);

    // Stale: move it aside, then confirm what we moved is the stale lock we judged.
    const aside = `${path}.stale-${pid}-${attempt}`;
    try {
      renameSync(path, aside);
    } catch (e) {
      if (code(e) === "ENOENT") continue; // someone else reclaimed it first
      throw e;
    }
    const moved = readPid(aside);
    if (moved !== owner && moved !== "missing") {
      // We raced and moved a fresh lock; restore it unless yet another one appeared.
      try {
        linkSync(aside, path);
      } catch (e) {
        if (code(e) !== "EEXIST") throw e;
      }
    }
    rmSync(aside, { force: true });
  }
  throw new Error(`Could not acquire ${path}: too much contention`);
}

function makeLock(path: string, pid: number): Lock {
  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      if (readPid(path) === pid) rmSync(path, { force: true });
    },
  };
}
