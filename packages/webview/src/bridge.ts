import {
  ApiError,
  ErrorCode,
  type OpInput,
  type OpName,
  type OpOutput,
  type ServerEvent,
  type ToHost,
  type ToView,
} from "@emos/api-contract";
import { useEffect, useState } from "preact/hooks";

/** The subset of the VS Code webview API this app uses. */
export interface VsCodeApi {
  postMessage(message: ToHost): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export type ConnectionState = Extract<ToView, { kind: "connection" }>["state"];

export const RPC_TIMEOUT_MS = 30_000;

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

let api: VsCodeApi | undefined;
let connection: ConnectionState = "connecting";
const pending = new Map<string, Pending>();
const eventListeners = new Set<(e: ServerEvent) => void>();
const connectionListeners = new Set<(s: ConnectionState) => void>();

function isConnectionState(v: unknown): v is ConnectionState {
  return v === "connecting" || v === "connected" || v === "unavailable";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function onMessage(ev: MessageEvent): void {
  const msg: unknown = ev.data;
  if (!isRecord(msg)) return;
  switch (msg.kind) {
    case "rpc-result": {
      if (typeof msg.reqId !== "string") return;
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      clearTimeout(p.timer);
      if (msg.ok === true) {
        p.resolve(msg.result);
      } else {
        const error = isRecord(msg.error) ? msg.error : {};
        const code = ErrorCode.safeParse(error.code);
        const message = typeof error.message === "string" ? error.message : undefined;
        p.reject(new ApiError(code.success ? code.data : "internal", message));
      }
      return;
    }
    case "event": {
      const event = msg.event as ServerEvent;
      for (const fn of [...eventListeners]) fn(event);
      return;
    }
    case "connection": {
      if (!isConnectionState(msg.state)) return;
      connection = msg.state;
      for (const fn of [...connectionListeners]) fn(connection);
      return;
    }
  }
}

/**
 * Start the bridge: take the VS Code API (once per page; injectable for tests), listen for host
 * messages and tell the host the webview is ready. Calling it again replaces the previous
 * session. Entry points call this before rendering; the first `rpc`/`useConnection` call starts
 * it lazily if they did not.
 */
export function installBridge(vscode: VsCodeApi = acquireVsCodeApi()): void {
  uninstallBridge();
  api = vscode;
  window.addEventListener("message", onMessage);
  vscode.postMessage({ kind: "ready" });
}

/** Stop listening, fail in-flight requests and reset state. Used by tests. */
export function uninstallBridge(): void {
  window.removeEventListener("message", onMessage);
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new ApiError("unavailable", "bridge closed"));
  }
  pending.clear();
  api = undefined;
  connection = "connecting";
}

function host(): VsCodeApi {
  if (!api) installBridge();
  return api as VsCodeApi;
}

export function rpc<N extends OpName>(op: N, input: OpInput<N>): Promise<OpOutput<N>> {
  const vscode = host();
  const reqId = crypto.randomUUID();
  return new Promise<OpOutput<N>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new ApiError("unavailable", `${op} timed out`));
    }, RPC_TIMEOUT_MS);
    pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer });
    vscode.postMessage({ kind: "rpc", reqId, op, input });
  });
}

/** Subscribe to server-sent events relayed by the host. Returns an unsubscribe function. */
export function onEvent(fn: (e: ServerEvent) => void): () => void {
  host();
  eventListeners.add(fn);
  return () => {
    eventListeners.delete(fn);
  };
}

/** Post a `command` to the host (e.g. `emos.reconnect`). */
export function command(name: string, ...args: unknown[]): void {
  host().postMessage(
    args.length > 0 ? { kind: "command", command: name, args } : { kind: "command", command: name },
  );
}

export function useConnection(): ConnectionState {
  host();
  const [state, setState] = useState<ConnectionState>(connection);
  useEffect(() => {
    connectionListeners.add(setState);
    setState(connection);
    return () => {
      connectionListeners.delete(setState);
    };
  }, []);
  return state;
}
