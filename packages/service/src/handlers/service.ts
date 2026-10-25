import { ApiError } from "@emos/api-contract";
import type { Handler } from "../context.js";

/** Replies first; the server stops once this response has been sent (see `requestShutdown`). */
export const serviceShutdown: Handler<"service.shutdown"> = (ctx, input) => {
  if (input.pid !== process.pid) throw new ApiError("conflict", "Service pid does not match");
  ctx.requestShutdown();
  return { ok: true };
};
