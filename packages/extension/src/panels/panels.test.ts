import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { BridgeConnection } from "../bridge.js";
import { type FakeWebviewPanel, FakeWebviewView, resetMock } from "../test/vscode.js";
import { disposeDashboard, showDashboard } from "./dashboard.js";
import { SidebarProvider } from "./sidebar.js";

const connection: BridgeConnection = {
  state: "connecting",
  call: vi.fn(async () => ({})),
  onStateChange: () => ({ dispose() {} }),
  onEvent: () => ({ dispose() {} }),
};
const assetsRoot = vscode.Uri.file("/ext/webview-dist");
const deps = { assetsRoot, connection, executeCommand: vi.fn(async () => undefined) };

beforeEach(() => {
  disposeDashboard();
  resetMock();
});

describe("dashboard panel", () => {
  it("opens one panel with retainContextWhenHidden and assets-only resource roots", () => {
    showDashboard(deps);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as FakeWebviewPanel;
    expect(panel.viewType).toBe("emos.dashboard");
    expect(panel.options).toMatchObject({
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [assetsRoot],
    });
    expect(panel.webview.html).toContain("/webview/ext/webview-dist/dashboard.js");
    expect(panel.webview.html).toContain("/webview/ext/webview-dist/theme.css");
    expect(panel.webview.html).toContain("default-src 'none'");
  });

  it("reveals the existing panel instead of opening a second one", () => {
    showDashboard(deps);
    showDashboard(deps);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as FakeWebviewPanel;
    expect(panel.reveal).toHaveBeenCalled();
  });

  it("opens a fresh panel after the previous one was closed", () => {
    showDashboard(deps);
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as FakeWebviewPanel;
    panel.dispose();
    showDashboard(deps);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it("is wired to the bridge (ready -> connection state)", () => {
    showDashboard(deps);
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as FakeWebviewPanel;
    panel.webview.deliver({ kind: "ready" });
    expect(panel.webview.posted).toEqual([{ kind: "connection", state: "connecting" }]);
  });

  it("uses a new nonce on every load", () => {
    showDashboard(deps);
    const first = vi.mocked(vscode.window.createWebviewPanel).mock.results[0]
      ?.value as FakeWebviewPanel;
    const nonce1 = /nonce="([^"]+)"/.exec(first.webview.html)?.[1];
    first.dispose();
    showDashboard(deps);
    const second = vi.mocked(vscode.window.createWebviewPanel).mock.results[1]
      ?.value as FakeWebviewPanel;
    const nonce2 = /nonce="([^"]+)"/.exec(second.webview.html)?.[1];
    expect(nonce1).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });
});

describe("sidebar view", () => {
  it("renders the sidebar bundle with scripts enabled and assets-only resource roots", () => {
    const view = new FakeWebviewView();
    new SidebarProvider(deps).resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.webview.options).toEqual({ enableScripts: true, localResourceRoots: [assetsRoot] });
    expect(view.webview.html).toContain("/webview/ext/webview-dist/sidebar.js");
    view.webview.deliver({ kind: "ready" });
    expect(view.webview.posted).toEqual([{ kind: "connection", state: "connecting" }]);
  });
});
