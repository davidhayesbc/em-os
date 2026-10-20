import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { ApiError } from "@emos/api-contract";
import { assertNotInGitCheckout, toDbInstant } from "@emos/store-sqlite";
import type { Handler } from "../context.js";

/**
 * Snapshots the database to `dest` (`Db.backup`, which creates the parent directory). Refuses
 * a relative path, a destination inside a git checkout (data must never be committable) and
 * overwriting an existing file.
 */
export const backupCreate: Handler<"backup.create"> = async (ctx, { dest }) => {
  if (!isAbsolute(dest)) throw new ApiError("invalid_input", "dest must be an absolute path");
  try {
    assertNotInGitCheckout(dirname(dest), existsSync);
  } catch {
    throw new ApiError("invalid_input", "Refusing to write a backup inside a git checkout");
  }
  if (existsSync(dest)) throw new ApiError("conflict", "Destination already exists");
  await ctx.db.backup(dest);
  return { path: dest, bytes: statSync(dest).size, createdAt: toDbInstant(ctx.clock.now()) };
};
