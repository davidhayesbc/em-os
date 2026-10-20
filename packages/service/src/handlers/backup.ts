import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { ApiError } from "@emos/api-contract";
import { assertNotInGitCheckout, toDbInstant } from "@emos/store-sqlite";
import type { Handler } from "../context.js";

const POSIX = process.platform !== "win32";

function exists(path: string): boolean {
  try {
    lstatSync(path); // lstat: a dangling symlink counts as existing
    return true;
  } catch {
    return false;
  }
}

/**
 * `dir` with symlinks resolved as far as it exists (the deepest existing ancestor is
 * realpath'ed, the not-yet-created rest is appended), so a symlink into a checkout is seen.
 */
function resolveThroughSymlinks(dir: string): string {
  const rest: string[] = [];
  let current = dir;
  for (;;) {
    try {
      return join(realpathSync(current), ...rest.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return dir;
      rest.push(basename(current));
      current = parent;
    }
  }
}

/** The filesystem operations behind publishing; injectable so tests can force failures. */
export interface PublishOps {
  link(existing: string, path: string): void;
  /** Creates `path` exclusively (mode 0600) and returns its fd; throws EEXIST if it exists. */
  openExcl(path: string): number;
  /** Copies all of `src` into `fd` and flushes it. Does not close `fd`. */
  copyToFd(src: string, fd: number): void;
  close(fd: number): void;
  remove(path: string): void;
}

export const defaultPublishOps: PublishOps = {
  link: linkSync,
  openExcl: (path) => openSync(path, "wx", 0o600),
  copyToFd: (src, fd) => {
    const input = openSync(src, "r");
    try {
      const buf = Buffer.allocUnsafe(64 * 1024);
      for (;;) {
        const n = readSync(input, buf, 0, buf.length, null);
        if (n === 0) break;
        let off = 0;
        while (off < n) off += writeSync(fd, buf, off, n - off);
      }
      fsyncSync(fd);
    } finally {
      closeSync(input);
    }
  },
  close: closeSync,
  remove: (path) => rmSync(path, { force: true }),
};

/** `link()` failures that mean "this filesystem has no hard links" (so copy instead). */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"]);

const conflict = () => new ApiError("conflict", "Destination already exists");

/**
 * Creates `dest` from `tmp` without ever replacing an existing entry, and never leaves a
 * partial `dest`: a hard link is atomic. The fallback (hard links unsupported, e.g. FAT/exFAT)
 * creates `dest` itself with an exclusive open and copies into it; only once that open has
 * succeeded is `dest` ours, so only then is it deleted if the copy fails.
 */
export function publishBackup(
  tmp: string,
  dest: string,
  ops: PublishOps = defaultPublishOps,
): void {
  try {
    ops.link(tmp, dest); // EEXIST if anything (even a dangling symlink) is at dest
    return;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw conflict();
    if (code === undefined || !NO_HARD_LINKS.has(code)) throw e;
  }
  let fd: number;
  try {
    fd = ops.openExcl(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw conflict(); // not ours: keep it
    throw e;
  }
  // From here on dest was created by this call.
  try {
    ops.copyToFd(tmp, fd);
  } catch (e) {
    try {
      ops.close(fd);
    } catch {
      // the copy error is the one to report
    }
    ops.remove(dest);
    throw e;
  }
  try {
    ops.close(fd);
  } catch (e) {
    ops.remove(dest);
    throw e;
  }
}

/**
 * True if `path` (a POSIX, drive-letter or UNC absolute path, with `/` or `\` separators) has
 * no `.`/`..`, empty (doubled or trailing separator) or missing segments after its root. Pure
 * string check, so it gives the same answer on every platform.
 */
export function hasCleanSegments(path: string): boolean {
  let rest: string;
  if (path.startsWith("\\\\")) {
    const m = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.exec(path); // \\server\share[\]
    if (!m) return false;
    rest = path.slice(m[0].length);
  } else if (/^[A-Za-z]:[\\/]/.test(path)) {
    rest = path.slice(3);
  } else if (path.startsWith("/")) {
    rest = path.slice(1);
  } else {
    return false;
  }
  return rest.split(/[\\/]/).every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/**
 * Snapshots the database to `dest` (`Db.backup`, which creates the parent directory). Refuses
 * a relative or non-normalised path, a destination inside a git checkout (also through
 * symlinks: data must never be committable) and overwriting anything that exists. The snapshot
 * is written to a temporary file beside `dest` and then published (see {@link publishBackup}),
 * so `dest` never holds a partial copy.
 */
export function makeBackupCreate(ops: PublishOps = defaultPublishOps): Handler<"backup.create"> {
  return async (ctx, { dest }) => {
    if (!isAbsolute(dest)) throw new ApiError("invalid_input", "dest must be an absolute path");
    if (!hasCleanSegments(dest)) {
      throw new ApiError(
        "invalid_input",
        "dest must not contain empty, . or .. segments or end in a separator",
      );
    }
    const dir = resolveThroughSymlinks(dirname(dest));
    try {
      assertNotInGitCheckout(dir, exists);
    } catch {
      throw new ApiError("invalid_input", "Refusing to write a backup inside a git checkout");
    }
    if (exists(dest)) throw conflict();

    const tmp = join(
      dir,
      `.${basename(dest)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await ctx.db.backup(tmp);
      // The snapshot is created with the process umask (often 0644). Tighten it before it is
      // published: a hard link shares the inode, so dest gets 0600 too (the copy fallback
      // creates dest 0600 itself).
      if (POSIX) chmodSync(tmp, 0o600);
      publishBackup(tmp, dest, ops);
    } finally {
      ops.remove(tmp);
    }
    return { path: dest, bytes: statSync(dest).size, createdAt: toDbInstant(ctx.clock.now()) };
  };
}

export const backupCreate: Handler<"backup.create"> = makeBackupCreate();
