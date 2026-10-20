// EM OS for VS Code: a thin client. Finds or starts the local service, relays webview RPC and
// events through the host (the webview never sees the token) and hosts the dashboard tab and
// the sidebar view. No business logic lives here.
import { homedir } from "node:os";
import * as vscode from "vscode";
import { ServiceConnection } from "./connection.js";
import { createLauncher } from "./launcher.js";
import { disposeDashboard, type PanelDeps, showDashboard } from "./panels/dashboard.js";
import { SidebarProvider } from "./panels/sidebar.js";
import { resolveDataDir, resolveWebviewDist } from "./runtime.js";

let connection: ServiceConnection | undefined;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function activate(
  context: vscode.ExtensionContext,
  options: { autoStart?: boolean } = {},
): void {
  const dataDir = resolveDataDir(process.env, process.platform, homedir());
  const launcher = createLauncher({
    extensionPath: context.extensionPath,
    allowPathNode: context.extensionMode !== vscode.ExtensionMode.Production,
  });
  const conn = new ServiceConnection({ dataDir, launcher });
  connection = conn;

  const executeCommand = (command: string, ...args: unknown[]) =>
    vscode.commands.executeCommand(command, ...args);

  let assets: vscode.Uri | undefined;
  const assetsRoot = (): vscode.Uri => {
    assets ??= vscode.Uri.file(resolveWebviewDist(context.extensionPath));
    return assets;
  };
  const panelDeps = (): PanelDeps => ({
    assetsRoot: assetsRoot(),
    connection: conn,
    executeCommand,
  });

  // TEST-ONLY (EMOS_TEST_HOOKS=1, set by the smoke test): record which rpcs the dashboard
  // webview completed, so the smoke test can tell the page loaded and got data from the service.
  // Op names and outcomes only; never inputs or results. Not contributed to the palette.
  const testHooks = process.env.EMOS_TEST_HOOKS === "1";
  const dashboardRpcResults: Array<{ op: string; ok: boolean }> = [];
  const dashboardDeps = (): PanelDeps =>
    testHooks
      ? { ...panelDeps(), onRpcResult: (op, ok) => dashboardRpcResults.push({ op, ok }) }
      : panelDeps();

  const connect = (): void => {
    conn.start().catch(async (e: unknown) => {
      const choice = await vscode.window.showErrorMessage(`EM OS: ${message(e)}`, "Reconnect");
      if (choice === "Reconnect") connect();
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("emos.openDashboard", () => {
      try {
        showDashboard(dashboardDeps());
      } catch (e) {
        void vscode.window.showErrorMessage(`EM OS: ${message(e)}`);
      }
    }),
    vscode.commands.registerCommand("emos.reconnect", () => connect()),
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, {
      resolveWebviewView(view) {
        try {
          new SidebarProvider(panelDeps()).resolveWebviewView(view);
        } catch (e) {
          void vscode.window.showErrorMessage(`EM OS: ${message(e)}`);
        }
      },
    }),
    { dispose: () => disposeDashboard() },
    ...(testHooks
      ? [
          vscode.commands.registerCommand("emos.test.dashboardRpcResults", () => [
            ...dashboardRpcResults,
          ]),
        ]
      : []),
    { dispose: () => conn.dispose() },
  );

  // Activation only happens when the user opens EM OS (dashboard command or sidebar view), so
  // start (or attach to) the service right away. The service outlives this window.
  if (options.autoStart !== false) connect();
}

export function deactivate(): void {
  connection?.dispose();
  connection = undefined;
}
