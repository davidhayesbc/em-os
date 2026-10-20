import { ApiError, type ServerEvent } from "@emos/api-contract/bridge";
import { act, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge, onEvent, rpc, uninstallBridge, useConnection } from "./bridge.js";
import { createFakeVsCode, type FakeVsCode } from "./test-support.js";

const HEALTH = {
  apiVersion: 1,
  serviceVersion: "0.0.1",
  startedAt: "2026-10-20T16:00:00.000Z",
  dataDir: "/data",
  connectors: [],
};

let host: FakeVsCode;

beforeEach(() => {
  host = createFakeVsCode();
  installBridge(host.api);
});

afterEach(() => {
  uninstallBridge();
  vi.useRealTimers();
});

describe("bridge lifecycle", () => {
  it("posts ready once on install", () => {
    expect(host.posted.filter((m) => m.kind === "ready")).toHaveLength(1);
    host.dispatch({ kind: "connection", state: "connected" });
    expect(host.posted.filter((m) => m.kind === "ready")).toHaveLength(1);
  });
});

describe("rpc", () => {
  it("posts an rpc message and resolves on the matching rpc-result", async () => {
    const p = rpc("health.get", {});
    const req = host.lastRpc("health.get");
    expect(req).toMatchObject({ kind: "rpc", op: "health.get", input: {} });
    expect(req?.reqId).toEqual(expect.any(String));
    host.dispatch({ kind: "rpc-result", reqId: req?.reqId ?? "", ok: true, result: HEALTH });
    await expect(p).resolves.toEqual(HEALTH);
  });

  it("uses a distinct reqId per call and ignores results for other ids", async () => {
    const a = rpc("health.get", {});
    const b = rpc("health.get", {});
    const [ra, rb] = host.posted.filter((m) => m.kind === "rpc");
    expect(ra?.kind === "rpc" && rb?.kind === "rpc" && ra.reqId !== rb.reqId).toBe(true);
    host.dispatch({ kind: "rpc-result", reqId: "unrelated", ok: true, result: "x" });
    if (rb?.kind === "rpc")
      host.dispatch({ kind: "rpc-result", reqId: rb.reqId, ok: true, result: "b" });
    if (ra?.kind === "rpc")
      host.dispatch({ kind: "rpc-result", reqId: ra.reqId, ok: true, result: "a" });
    await expect(a).resolves.toBe("a");
    await expect(b).resolves.toBe("b");
  });

  it("rejects with an ApiError carrying the code when ok is false", async () => {
    const p = rpc("health.get", {});
    const req = host.lastRpc("health.get");
    host.dispatch({
      kind: "rpc-result",
      reqId: req?.reqId ?? "",
      ok: false,
      error: { code: "unauthorized", message: "bad token" },
    });
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ code: "unauthorized", message: "bad token" });
  });

  it("maps an unknown error code to internal", async () => {
    const p = rpc("health.get", {});
    host.dispatch({
      kind: "rpc-result",
      reqId: host.lastRpc("health.get")?.reqId ?? "",
      ok: false,
      error: { code: "weird", message: "huh" },
    });
    await expect(p).rejects.toMatchObject({ code: "internal" });
  });

  it("rejects with unavailable after 30 s without a result", async () => {
    vi.useFakeTimers();
    const p = rpc("health.get", {});
    const settled = p.then(
      () => "resolved",
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(29_999);
    host.dispatch({ kind: "connection", state: "connected" });
    await vi.advanceTimersByTimeAsync(1);
    const err = await settled;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "unavailable" });
  });

  it("ignores a late result after the timeout", async () => {
    vi.useFakeTimers();
    const p = rpc("health.get", {}).catch((e: unknown) => e);
    const req = host.lastRpc("health.get");
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    expect(() =>
      host.dispatch({ kind: "rpc-result", reqId: req?.reqId ?? "", ok: true, result: HEALTH }),
    ).not.toThrow();
  });

  it("ignores malformed messages", () => {
    expect(() => {
      window.dispatchEvent(new MessageEvent("message", { data: null }));
      window.dispatchEvent(new MessageEvent("message", { data: "text" }));
      window.dispatchEvent(new MessageEvent("message", { data: { kind: "nope" } }));
    }).not.toThrow();
  });
});

describe("onEvent", () => {
  it("delivers server events until unsubscribed", () => {
    const seen: ServerEvent[] = [];
    const off = onEvent((e) => seen.push(e));
    const event: ServerEvent = { type: "sync.status", connectorId: "c1", state: "ok" };
    host.dispatch({ kind: "event", event });
    off();
    host.dispatch({ kind: "event", event });
    expect(seen).toEqual([event]);
  });
});

describe("useConnection", () => {
  function Probe() {
    return <p data-testid="state">{useConnection()}</p>;
  }

  it("starts connecting and follows connection messages", () => {
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("connecting");
    act(() => host.dispatch({ kind: "connection", state: "connected" }));
    expect(screen.getByTestId("state").textContent).toBe("connected");
    act(() => host.dispatch({ kind: "connection", state: "unavailable" }));
    expect(screen.getByTestId("state").textContent).toBe("unavailable");
  });

  it("reflects a connection message that arrived before mount", () => {
    host.dispatch({ kind: "connection", state: "connected" });
    render(<Probe />);
    expect(screen.getByTestId("state").textContent).toBe("connected");
  });
});
