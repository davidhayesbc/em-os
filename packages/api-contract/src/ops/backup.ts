import { z } from "zod";
import { IsoDateTime } from "../entities/common.js";
import { defineOp } from "../op.js";

/** POSIX (`/x`), Windows drive (`C:\x`, `C:/x`) or UNC (`\\host\share`) absolute path. */
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** Consistent online snapshot of the database, written to a new file at `dest`. */
export const backupCreate = defineOp({
  name: "backup.create",
  input: z.object({
    dest: z
      .string()
      .min(1)
      .refine((p) => ABSOLUTE_PATH.test(p), "dest must be an absolute path"),
  }),
  output: z.object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    createdAt: IsoDateTime,
  }),
});
