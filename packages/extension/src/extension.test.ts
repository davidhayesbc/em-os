import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { activate, deactivate } from "./extension.js";
import { resetMock } from "./test/vscode.js";

beforeEach(() => resetMock());

describe("activate", () => {
  it("registers the commands and the sidebar view provider", () => {
    const subscriptions: Array<{ dispose(): unknown }> = [];
    const context = {
      subscriptions,
      extensionPath: "/nonexistent-extension",
      extensionMode: vscode.ExtensionMode.Test,
    } as unknown as vscode.ExtensionContext;
    // Never start a real service from a unit test: point the launcher at nothing.
    vi.stubEnv("EMOS_NODE_PATH", "/nonexistent/node");
    vi.stubEnv("EMOS_DATA_DIR", "/nonexistent-data-dir");
    try {
      activate(context, { autoStart: false });
      const ids = vi.mocked(vscode.commands.registerCommand).mock.calls.map((c) => c[0]);
      expect(ids.sort()).toEqual(["emos.openDashboard", "emos.reconnect"]);
      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledWith(
        "emos.sidebar",
        expect.anything(),
      );
      expect(subscriptions.length).toBeGreaterThanOrEqual(3);
      for (const s of subscriptions) s.dispose();
      deactivate();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("registers the test-only dashboard probe only when EMOS_TEST_HOOKS=1", async () => {
    const context = {
      subscriptions: [] as Array<{ dispose(): unknown }>,
      extensionPath: "/nonexistent-extension",
      extensionMode: vscode.ExtensionMode.Production,
    } as unknown as vscode.ExtensionContext;
    vi.stubEnv("EMOS_NODE_PATH", "/nonexistent/node");
    vi.stubEnv("EMOS_DATA_DIR", "/nonexistent-data-dir");
    vi.stubEnv("EMOS_TEST_HOOKS", "1");
    try {
      activate(context, { autoStart: false });
      const calls = vi.mocked(vscode.commands.registerCommand).mock.calls;
      const probe = calls.find((c) => c[0] === "emos.test.dashboardRpcResults");
      expect(probe).toBeDefined();
      expect(await probe?.[1]()).toEqual([]);
      for (const s of context.subscriptions) s.dispose();
      deactivate();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
