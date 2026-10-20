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
import { basename, dirname, isAbsolute, join } from "node:path";
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

/** Creates `dest` from `tmp` without ever replacing an existing entry. */
function publish(tmp: string, dest: string): void {
  try {
    linkSync(tmp, dest); // atomic; EEXIST if anything (even a dangling symlink) is at dest
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new ApiError("conflict", "Destination already exists");
    // No hard links on this filesystem (e.g. FAT/exFAT): exclusive copy instead.
    try {
      copyFileSync(tmp, dest, fsConstants.COPYFILE_EXCL);
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ApiError("conflict", "Destination already exists");
      }
      throw e2;
    }
  }
}

/**
 * Snapshots the database to `dest` (`Db.backup`, which creates the parent directory). Refuses
 * a relative path, a destination inside a git checkout (also through symlinks: data must never
 * be committable) and overwriting anything that exists. The snapshot is written to a temporary
 * file beside `dest` and then published with a hard link, so `dest` never holds a partial copy.
 */
export const backupCreate: Handler<"backup.create"> = async (ctx, { dest }) => {
  if (!isAbsolute(dest)) throw new ApiError("invalid_input", "dest must be an absolute path");
  const dir = dirname(dest);
  try {
    assertNotInGitCheckout(resolveThroughSymlinks(dir), exists);
  } catch {
    throw new ApiError("invalid_input", "Refusing to write a backup inside a git checkout");
  }
  if (exists(dest)) throw new ApiError("conflict", "Destination already exists");

  const tmp = join(dir, `.${basename(dest)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await ctx.db.backup(tmp);
    publish(tmp, dest);
  } finally {
    rmSync(tmp, { force: true });
  }
  return { path: dest, bytes: statSync(dest).size, createdAt: toDbInstant(ctx.clock.now()) };
};
