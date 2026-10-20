// In-process event bus and the `GET /events` Server-Sent Events stream.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerEvent } from "@emos/api-contract";
import type { Logger } from "@emos/core";

export interface EventBus {
  publish(e: ServerEvent): void;
  /** Returns the unsubscribe function. */
  subscribe(fn: (e: ServerEvent) => void): () => void;
}

/** A synchronous fan-out bus. A throwing subscriber doesn't stop delivery to the others. */
export function createEventBus(log?: Logger): EventBus & { readonly size: number } {
  const subs = new Set<(e: ServerEvent) => void>();
  return {
    get size() {
      return subs.size;
    },
    publish(e) {
      for (const fn of [...subs]) {
        try {
          fn(e);
        } catch (err) {
          log?.warn("events.subscriber_failed", { errorName: (err as Error)?.name ?? "unknown" });
        }
      }
    },
    subscribe(fn) {
      // Wrap so the same function can subscribe twice and unsubscribe independently.
      const wrapped = (e: ServerEvent) => fn(e);
      subs.add(wrapped);
      return () => {
        subs.delete(wrapped);
      };
    },
  };
}

/**
 * Serves one SSE client: `data: <ServerEvent JSON>\n\n` per event and a `: heartbeat` comment
 * every `heartbeatMs`. Unsubscribes when the client goes away. Returns a function that ends the
 * stream from the server side (used by `stop()`).
 */
export function serveEvents(
  req: IncomingMessage,
  res: ServerResponse,
  bus: EventBus,
  heartbeatMs: number,
): () => void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  res.write(": connected\n\n");

  const unsubscribe = bus.subscribe((e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  });
  const timer = setInterval(() => res.write(": heartbeat\n\n"), heartbeatMs);
  timer.unref();

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    unsubscribe();
  };
  req.on("close", close);
  res.on("close", close);
  return () => {
    close();
    res.end();
  };
}
