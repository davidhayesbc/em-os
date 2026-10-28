import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { installBridge, uninstallBridge } from "./bridge.js";
import { Sidebar } from "./Sidebar.js";
import { createFakeVsCode, type FakeVsCode } from "./test-support.js";
import { ServiceStatus } from "./widgets/ServiceStatus.js";

let host: FakeVsCode;

beforeEach(() => {
  host = createFakeVsCode();
  installBridge(host.api);
});

afterEach(() => {
  cleanup();
  uninstallBridge();
});

function health(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 1,
    serviceVersion: "0.4.2",
    startedAt: new Date(Date.now() - (2 * 3600 + 5 * 60 + 10) * 1000).toISOString(),
    dataDir: "/data",
    secretStore: "keychain",
    connectors: [],
    ...overrides,
  };
}

describe("App", () => {
  it("renders unavailable state with a Retry button", () => {
    render(<App />);
    act(() => host.dispatch({ kind: "connection", state: "unavailable" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Service unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(host.posted).toContainEqual({ kind: "command", command: "emos.reconnect" });
  });

  it("shows a connecting state before the host reports", () => {
    render(<App />);
    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(host.lastRpc("health.get")).toBeUndefined();
  });

  it("renders the widget grid with the service status widget when connected", async () => {
    render(<App />);
    act(() => host.dispatch({ kind: "connection", state: "connected" }));
    expect(screen.getByRole("heading", { name: "Service status" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Manual commitments" })).toBeTruthy();
    await waitFor(() => expect(host.lastRpc("health.get")).toBeDefined());
    act(() => host.resolve("health.get", health()));
    expect(await screen.findByText("API v1")).toBeTruthy();
  });

  it("leaves the grid when the connection drops", () => {
    render(<App />);
    act(() => host.dispatch({ kind: "connection", state: "connected" }));
    expect(screen.queryByRole("heading", { name: "Manual commitments" })).toBeTruthy();
    act(() => host.dispatch({ kind: "connection", state: "unavailable" }));
    expect(screen.queryByRole("heading", { name: "Service status" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Manual commitments" })).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("ServiceStatus", () => {
  it("renders API v1, version, uptime and no-connectors text", async () => {
    render(<ServiceStatus size={{ w: 2, h: 1 }} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    act(() => host.resolve("health.get", health()));
    expect(await screen.findByText("API v1")).toBeTruthy();
    expect(screen.getByText("0.4.2")).toBeTruthy();
    expect(screen.getByText("2h 5m")).toBeTruthy();
    expect(screen.getByText("No connectors yet")).toBeTruthy();
  });

  it("lists connectors with their state", async () => {
    render(<ServiceStatus size={{ w: 2, h: 1 }} />);
    act(() =>
      host.resolve(
        "health.get",
        health({
          connectors: [
            { id: "calendar", state: "idle", lastSuccessAt: "2026-10-20T16:00:00.000Z" },
            { id: "mail", state: "error", lastSuccessAt: null },
          ],
        }),
      ),
    );
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("calendar"),
      expect.stringContaining("mail"),
    ]);
    expect(items[0]?.textContent).toContain("idle");
    expect(items[1]?.textContent).toContain("error");
    expect(screen.queryByText("No connectors yet")).toBeNull();
  });

  it("shows an error when health.get fails", async () => {
    render(<ServiceStatus size={{ w: 2, h: 1 }} />);
    const req = host.lastRpc("health.get");
    act(() =>
      host.dispatch({
        kind: "rpc-result",
        reqId: req?.reqId ?? "",
        ok: false,
        error: { code: "unavailable", message: "down" },
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load service status",
    );
  });

  it("refetches when a sync.status event arrives", async () => {
    render(<ServiceStatus size={{ w: 2, h: 1 }} />);
    act(() => host.resolve("health.get", health()));
    await screen.findByText("API v1");
    const before = host.posted.filter((m) => m.kind === "rpc").length;
    act(() =>
      host.dispatch({
        kind: "event",
        event: { type: "sync.status", connectorId: "mail", state: "ok" },
      }),
    );
    await waitFor(() =>
      expect(host.posted.filter((m) => m.kind === "rpc").length).toBeGreaterThan(before),
    );
  });
});

describe("Sidebar", () => {
  it("shows the connection state and opens the dashboard", () => {
    render(<Sidebar />);
    expect(screen.getByText("Connecting…")).toBeTruthy();
    act(() => host.dispatch({ kind: "connection", state: "connected" }));
    expect(screen.getByText("Connected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    expect(host.posted).toContainEqual({ kind: "command", command: "emos.openDashboard" });
  });

  it("offers Retry when the service is unavailable", () => {
    render(<Sidebar />);
    act(() => host.dispatch({ kind: "connection", state: "unavailable" }));
    expect(screen.getByText("Service unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(host.posted).toContainEqual({ kind: "command", command: "emos.reconnect" });
  });
});
