// The `emos.sidebar` webview view in the EM OS activity-bar container.
import type * as vscode from "vscode";
import { attach } from "../bridge.js";
import { loadWebview } from "../html.js";
import type { PanelDeps } from "./dashboard.js";

export class SidebarProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "emos.sidebar";

  constructor(private readonly deps: PanelDeps) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.deps.assetsRoot] };
    const bridge = attach(view.webview, this.deps.connection, this.deps);
    loadWebview(view.webview, this.deps.assetsRoot, "sidebar.js");
    view.onDidDispose(() => bridge.dispose());
  }
}
