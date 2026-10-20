import type { ServerEvent } from "./events.js";

/** Webview -> extension host. The webview never sees the service token. */
export type ToHost =
  | { kind: "rpc"; reqId: string; op: string; input: unknown }
  | { kind: "ready" }
  | { kind: "command"; command: string; args?: unknown[] };

/** Extension host -> webview. */
export type ToView =
  | { kind: "rpc-result"; reqId: string; ok: true; result: unknown }
  | { kind: "rpc-result"; reqId: string; ok: false; error: { code: string; message: string } }
  | { kind: "event"; event: ServerEvent }
  | { kind: "connection"; state: "connecting" | "connected" | "unavailable" };
