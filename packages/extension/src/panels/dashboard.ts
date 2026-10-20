// The dashboard editor tab: one instance (revealed if already open), kept alive while hidden
// so widgets don't reload on every tab switch.
import * as vscode from "vscode";
import { attach, type BridgeConnection, type BridgeOptions } from "../bridge.js";
import { loadWebview } from "../html.js";

export interface PanelDeps extends BridgeOptions {
  /** The webview bundle directory; the only local resource root the webview may load from. */
  assetsRoot: vscode.Uri;
  connection: BridgeConnection;
}

let current: vscode.WebviewPanel | undefined;

export function showDashboard(deps: PanelDeps): vscode.WebviewPanel {
  if (current) {
    current.reveal();
    return current;
  }
  const panel = vscode.window.createWebviewPanel(
    "emos.dashboard",
    "EM OS",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [deps.assetsRoot],
    },
  );
  const bridge = attach(panel.webview, deps.connection, deps);
  loadWebview(panel.webview, deps.assetsRoot, "dashboard.js");
  panel.onDidDispose(() => {
    bridge.dispose();
    if (current === panel) current = undefined;
  });
  current = panel;
  return panel;
}

/** Closes the dashboard if it is open (deactivate, tests). */
export function disposeDashboard(): void {
  current?.dispose();
  current = undefined;
}
