import type { Handler } from "../context.js";

/** Replies first; the server stops once this response has been sent (see `requestShutdown`). */
export const serviceShutdown: Handler<"service.shutdown"> = (ctx) => {
  ctx.requestShutdown();
  return { ok: true };
};
