// The webview <-> extension-host message bridge (`ToHost`/`ToView` in @emos/api-contract).
// The host does the talking to the service; the webview only ever sees op results, events and
// a connection state — never the token, port or URL.
import { ApiError, ops, type ServerEvent, type ToView } from "@emos/api-contract";
import type { ConnectionState, Disposable } from "./connection.js";

/** The subset of `vscode.Webview` the bridge needs. */
export interface WebviewLike {
  postMessage(message: unknown): Thenable<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => unknown): { dispose(): unknown };
}

/** What the bridge needs from the service connection (see `ServiceConnection`). */
export interface BridgeConnection {
  readonly state: ConnectionState;
  call(op: string, input: unknown): Promise<unknown>;
  onStateChange(fn: (s: ConnectionState) => void): Disposable;
  onEvent(fn: (e: ServerEvent) => void): Disposable;
}

export interface BridgeOptions {
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
}

/** Commands a webview may ask the host to run. Anything else is ignored. */
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "emos.openDashboard",
  "emos.reconnect",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isKnownOp(op: string): boolean {
  return Object.hasOwn(ops, op);
}

export function attach(
  webview: WebviewLike,
  connection: BridgeConnection,
  opts: BridgeOptions,
): Disposable {
  let disposed = false;

  const post = (msg: ToView): void => {
    if (disposed) return;
    // Rejects once the webview is gone; nothing to do about it.
    Promise.resolve(webview.postMessage(msg)).catch(() => undefined);
  };

  const rpc = async (reqId: string, op: string, input: unknown): Promise<void> => {
    if (!isKnownOp(op)) {
      post({
        kind: "rpc-result",
        reqId,
        ok: false,
        error: { code: "not_found", message: "Unknown op" },
      });
      return;
    }
    try {
      const result = await connection.call(op, input);
      post({ kind: "rpc-result", reqId, ok: true, result });
    } catch (e) {
      const error =
        e instanceof ApiError
          ? { code: e.code, message: e.message }
          : { code: "internal", message: "Internal error" };
      post({ kind: "rpc-result", reqId, ok: false, error });
    }
  };

  const onMessage = (msg: unknown): void => {
    if (disposed || !isRecord(msg)) return;
    switch (msg.kind) {
      case "ready":
        post({ kind: "connection", state: connection.state });
        return;
      case "rpc":
        if (typeof msg.reqId !== "string" || typeof msg.op !== "string") return;
        void rpc(msg.reqId, msg.op, msg.input);
        return;
      case "command": {
        if (typeof msg.command !== "string" || !ALLOWED_COMMANDS.has(msg.command)) return;
        if (msg.args !== undefined && !Array.isArray(msg.args)) return;
        const args = (msg.args as unknown[] | undefined) ?? [];
        Promise.resolve(opts.executeCommand(msg.command, ...args)).catch(() => undefined);
        return;
      }
    }
  };

  const subs = [
    webview.onDidReceiveMessage(onMessage),
    connection.onStateChange((state) => post({ kind: "connection", state })),
    connection.onEvent((event) => post({ kind: "event", event })),
  ];

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const s of subs) s.dispose();
    },
  };
}
