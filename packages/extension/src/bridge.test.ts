import { ApiError, type ServerEvent } from "@emos/api-contract";
import { describe, expect, it, vi } from "vitest";
import { attach, type BridgeConnection } from "./bridge.js";
import type { ConnectionState } from "./connection.js";
import { FakeWebview } from "./test/vscode.js";

function fakeConnection(call: BridgeConnection["call"] = async () => ({ ok: 1 })) {
  let state: ConnectionState = "connecting";
  const stateFns = new Set<(s: ConnectionState) => void>();
  const eventFns = new Set<(e: ServerEvent) => void>();
  const conn: BridgeConnection = {
    get state() {
      return state;
    },
    call: vi.fn(call),
    onStateChange(fn) {
      stateFns.add(fn);
      return { dispose: () => stateFns.delete(fn) };
    },
    onEvent(fn) {
      eventFns.add(fn);
      return { dispose: () => eventFns.delete(fn) };
    },
  };
  return {
    conn,
    setState(s: ConnectionState) {
      state = s;
      for (const fn of [...stateFns]) fn(s);
    },
    emit(e: ServerEvent) {
      for (const fn of [...eventFns]) fn(e);
    },
    listenerCount: () => stateFns.size + eventFns.size,
  };
}

function setup(call?: BridgeConnection["call"]) {
  const webview = new FakeWebview();
  const fc = fakeConnection(call);
  const executeCommand = vi.fn(async () => undefined);
  const bridge = attach(webview, fc.conn, { executeCommand });
  return { webview, ...fc, executeCommand, bridge };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("bridge.attach", () => {
  it("proxies rpc and replies rpc-result ok", async () => {
    const { webview, conn } = setup(async () => ({ apiVersion: 1 }));
    webview.deliver({ kind: "rpc", reqId: "r1", op: "health.get", input: {} });
    await flush();
    expect(conn.call).toHaveBeenCalledWith("health.get", {});
    expect(webview.posted).toContainEqual({
      kind: "rpc-result",
      reqId: "r1",
      ok: true,
      result: { apiVersion: 1 },
    });
  });

  it("maps an ApiError to { ok: false, error: { code, message } }", async () => {
    const { webview } = setup(async () => {
      throw new ApiError("not_found", "No such goal");
    });
    webview.deliver({ kind: "rpc", reqId: "r2", op: "health.get", input: {} });
    await flush();
    expect(webview.posted).toContainEqual({
      kind: "rpc-result",
      reqId: "r2",
      ok: false,
      error: { code: "not_found", message: "No such goal" },
    });
  });

  it("maps any other error to `internal` without leaking its message", async () => {
    const { webview } = setup(async () => {
      throw new Error("secret detail /Users/someone");
    });
    webview.deliver({ kind: "rpc", reqId: "r3", op: "health.get", input: {} });
    await flush();
    expect(webview.posted).toContainEqual({
      kind: "rpc-result",
      reqId: "r3",
      ok: false,
      error: { code: "internal", message: "Internal error" },
    });
  });

  it("rejects an unknown op without calling the service", async () => {
    const { webview, conn } = setup();
    webview.deliver({ kind: "rpc", reqId: "r4", op: "../events", input: {} });
    await flush();
    expect(conn.call).not.toHaveBeenCalled();
    expect(webview.posted).toContainEqual({
      kind: "rpc-result",
      reqId: "r4",
      ok: false,
      error: { code: "not_found", message: "Unknown op" },
    });
  });

  it("sends the connection state on ready and on every change", () => {
    const { webview, setState } = setup();
    webview.deliver({ kind: "ready" });
    expect(webview.posted).toEqual([{ kind: "connection", state: "connecting" }]);
    setState("connected");
    setState("unavailable");
    expect(webview.posted.slice(1)).toEqual([
      { kind: "connection", state: "connected" },
      { kind: "connection", state: "unavailable" },
    ]);
  });

  it("forwards server events", () => {
    const { webview, emit } = setup();
    const event: ServerEvent = { type: "sync.status", connectorId: "c1", state: "ok" };
    emit(event);
    expect(webview.posted).toEqual([{ kind: "event", event }]);
  });

  it("executes only allowlisted emos.* commands", async () => {
    const { webview, executeCommand } = setup();
    webview.deliver({ kind: "command", command: "emos.reconnect" });
    webview.deliver({ kind: "command", command: "emos.openDashboard", args: [] });
    webview.deliver({ kind: "command", command: "workbench.action.terminal.new" });
    webview.deliver({ kind: "command", command: "emos.somethingElse" });
    await flush();
    expect(executeCommand.mock.calls).toEqual([["emos.reconnect"], ["emos.openDashboard"]]);
  });

  it("ignores malformed messages", async () => {
    const { webview, conn, executeCommand } = setup();
    for (const msg of [
      null,
      "ready",
      42,
      {},
      { kind: "nope" },
      { kind: "rpc", op: "health.get", input: {} },
      { kind: "rpc", reqId: 5, op: "health.get", input: {} },
      { kind: "rpc", reqId: "x", op: 7, input: {} },
      { kind: "command" },
      { kind: "command", command: "emos.reconnect", args: "not-an-array" },
    ]) {
      webview.deliver(msg);
    }
    await flush();
    expect(conn.call).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
    expect(webview.posted).toEqual([]);
  });

  it("never posts the token (or any connection detail) to the webview", async () => {
    const { webview, setState, emit } = setup(async () => ({ apiVersion: 1 }));
    webview.deliver({ kind: "ready" });
    webview.deliver({ kind: "rpc", reqId: "r1", op: "health.get", input: {} });
    setState("connected");
    emit({ type: "items.changed", entity: "goal", ids: [] });
    await flush();
    for (const m of webview.posted) {
      expect(JSON.stringify(m)).not.toMatch(/token|Bearer|127\.0\.0\.1/i);
    }
  });

  it("dispose stops listening and drops late rpc results", async () => {
    let resolve: (v: unknown) => void = () => {};
    const { webview, bridge, setState, listenerCount } = setup(
      () => new Promise((r) => (resolve = r)),
    );
    webview.deliver({ kind: "rpc", reqId: "late", op: "health.get", input: {} });
    bridge.dispose();
    expect(listenerCount()).toBe(0);
    resolve({});
    setState("connected");
    webview.deliver({ kind: "ready" });
    await flush();
    expect(webview.posted).toEqual([]);
  });

  it("survives postMessage rejecting (webview already disposed)", async () => {
    const { webview } = setup(async () => ({}));
    webview.postMessage = () => Promise.reject(new Error("Webview is disposed"));
    webview.deliver({ kind: "rpc", reqId: "r1", op: "health.get", input: {} });
    await flush();
    await flush();
  });
});
