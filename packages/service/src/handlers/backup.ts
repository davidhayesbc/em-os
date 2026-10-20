import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  constants as fsConstants,
  linkSync,
  lstatSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { ApiError } from "@emos/api-contract";
import { assertNotInGitCheckout, toDbInstant } from "@emos/store-sqlite";
import type { Handler } from "../context.js";

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
  copyExcl(src: string, dest: string): void;
  remove(path: string): void;
}

const defaultOps: PublishOps = {
  link: linkSync,
  copyExcl: (src, dest) => copyFileSync(src, dest, fsConstants.COPYFILE_EXCL),
  remove: (path) => rmSync(path, { force: true }),
};

/** `link()` failures that mean "this filesystem has no hard links" (so copy instead). */
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"]);

const conflict = () => new ApiError("conflict", "Destination already exists");

/**
 * Creates `dest` from `tmp` without ever replacing an existing entry, and never leaves a
 * partial `dest`: a hard link is atomic, and the exclusive-copy fallback (hard links
 * unsupported, e.g. FAT/exFAT) deletes what it created if the copy fails part way.
 */
export function publishBackup(tmp: string, dest: string, ops: PublishOps = defaultOps): void {
  try {
    ops.link(tmp, dest); // EEXIST if anything (even a dangling symlink) is at dest
    return;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw conflict();
    if (code === undefined || !NO_HARD_LINKS.has(code)) throw e;
  }
  try {
    ops.copyExcl(tmp, dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw conflict(); // not ours: keep it
    ops.remove(dest); // the exclusive open created it, so a partial copy is ours to delete
    throw e;
  }
}

/**
 * Snapshots the database to `dest` (`Db.backup`, which creates the parent directory). Refuses
 * a relative or non-normalised path, a destination inside a git checkout (also through
 * symlinks: data must never be committable) and overwriting anything that exists. The snapshot
 * is written to a temporary file beside `dest` and then published (see {@link publishBackup}),
 * so `dest` never holds a partial copy.
 */
export function makeBackupCreate(ops: PublishOps = defaultOps): Handler<"backup.create"> {
  return async (ctx, { dest }) => {
    if (!isAbsolute(dest)) throw new ApiError("invalid_input", "dest must be an absolute path");
    if (normalize(dest) !== dest) {
      throw new ApiError("invalid_input", "dest must be a normalised path (no .. or . segments)");
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
      publishBackup(tmp, dest, ops);
    } finally {
      ops.remove(tmp);
    }
    return { path: dest, bytes: statSync(dest).size, createdAt: toDbInstant(ctx.clock.now()) };
  };
}

export const backupCreate: Handler<"backup.create"> = makeBackupCreate();
