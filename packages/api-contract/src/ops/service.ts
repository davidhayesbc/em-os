import { z } from "zod";
import { defineOp } from "../op.js";

/**
 * Asks the service to stop: it answers `{ ok: true }`, then stops gracefully (closes the
 * database and removes `run/service.json` and the lock) and exits. Used by clients that need a
 * different service (a version mismatch) and by `emos service stop`, on every OS.
 */
export const serviceShutdown = defineOp({
  name: "service.shutdown",
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
});
