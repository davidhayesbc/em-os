import type { ToHost, ToView } from "@emos/api-contract/bridge";
import type { VsCodeApi } from "./bridge.js";

export interface FakeVsCode {
  api: VsCodeApi;
  /** Every message the webview posted to the extension host, in order. */
  posted: ToHost[];
  /** Deliver a host -> webview message as a `message` event on `window`. */
  dispatch(message: ToView): void;
  /** The most recent posted `rpc` message for `op` (undefined when none). */
  lastRpc(op: string): Extract<ToHost, { kind: "rpc" }> | undefined;
  /** Answer the most recent `rpc` for `op` with a successful result. */
  resolve(op: string, result: unknown): void;
}

export function createFakeVsCode(): FakeVsCode {
  const posted: ToHost[] = [];
  const api: VsCodeApi = { postMessage: (m) => void posted.push(m) };
  const dispatch = (message: ToView) => {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  };
  const lastRpc = (op: string) =>
    posted.findLast((m): m is Extract<ToHost, { kind: "rpc" }> => m.kind === "rpc" && m.op === op);
  return {
    api,
    posted,
    dispatch,
    lastRpc,
    resolve(op, result) {
      const req = lastRpc(op);
      if (!req) throw new Error(`no pending rpc for ${op}`);
      dispatch({ kind: "rpc-result", reqId: req.reqId, ok: true, result });
    },
  };
}
