// Runs inside the VS Code extension host, against the em-os VSIX installed into a clean
// profile (Production mode, so the service runs on the VSIX's bundled Node runtime).
import * as assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, httpTransport } from "@emos/api-contract";
import * as vscode from "vscode";

const EXTENSION_ID = "emos-dev.em-os";
const SERVICE_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `probe` until it returns a value other than undefined, or throws `what` on timeout. */
async function waitFor<T>(
  what: string,
  timeoutMs: number,
  probe: () => T | undefined | Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs} ms: ${what}`);
    await sleep(100);
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined; // absent, or caught mid-write
  }
}

/** Notification toasts can cover the editor; clear them (best effort). */
async function dismissNotifications(): Promise<void> {
  await Promise.resolve(vscode.commands.executeCommand("notifications.clearAll")).catch(
    () => undefined,
  );
}

export const tests: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "the installed VSIX carries its own runtime and service",
    async run() {
      const ext = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(ext, `${EXTENSION_ID} is installed`);
      const exe = process.platform === "win32" ? "node.exe" : "node";
      assert.ok(existsSync(join(ext.extensionPath, "dist", "runtime", exe)), "bundled runtime");
      assert.ok(existsSync(join(ext.extensionPath, "dist", "service", "main.js")), "service");
      assert.ok(existsSync(join(ext.extensionPath, "dist", "webview", "dashboard.js")), "webview");
    },
  },
  {
    name: "emos.openDashboard starts the service and shows a dashboard that loads service data",
    async run() {
      const dataDir = process.env.EMOS_DATA_DIR;
      assert.ok(dataDir, "EMOS_DATA_DIR is set by runTest.ts");
      assert.equal(process.env.EMOS_SECRET_STORE, "memory");
      await dismissNotifications();

      await vscode.commands.executeCommand("emos.openDashboard");

      const serviceJson = join(dataDir, "run", "service.json");
      const info = await waitFor("service.json", SERVICE_TIMEOUT_MS, () => {
        const v = readJson(serviceJson) as { port?: unknown; pid?: unknown } | undefined;
        return typeof v?.port === "number" && typeof v.pid === "number"
          ? { port: v.port, pid: v.pid }
          : undefined;
      });

      const token = readFileSync(join(dataDir, "run", "token"), "utf8").trim();
      const client = createClient({
        transport: httpTransport(`http://127.0.0.1:${info.port}`),
        token,
      });
      const health = await client.call("health.get", {});
      assert.equal(health.apiVersion, 1);

      const tab = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .find(
          (t) =>
            t.input instanceof vscode.TabInputWebview &&
            t.input.viewType.endsWith("emos.dashboard"),
        );
      assert.ok(tab, "a dashboard webview tab is open");
      assert.equal(tab.label, "EM OS");
      assert.ok(tab.isActive, "the dashboard tab is the active tab");

      // The page itself ran (CSP, assets) and got health.get back from the service through the
      // host bridge (test-only probe, EMOS_TEST_HOOKS=1).
      await waitFor("the dashboard's health.get rpc", SERVICE_TIMEOUT_MS, async () => {
        const results = (await vscode.commands.executeCommand(
          "emos.test.dashboardRpcResults",
        )) as Array<{ op: string; ok: boolean }>;
        return results.some((r) => r.op === "health.get" && r.ok) ? true : undefined;
      });
      await dismissNotifications();
    },
  },
];
