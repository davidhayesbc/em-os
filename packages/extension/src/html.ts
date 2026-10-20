// Webview HTML: the strict CSP from Global Constraints, a per-load nonce, `#root`, the theme
// stylesheet and one nonce'd script (the @emos/webview bundle). No inline script, no CDN.
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

/** 32 random base64 characters (24 bytes, so no padding). New for every load. */
export function createNonce(): string {
  return randomBytes(24).toString("base64");
}

export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface WebviewHtmlOptions {
  /** `webview.cspSource`. */
  cspSource: string;
  nonce: string;
  /** `webview.asWebviewUri(…/theme.css)`. */
  styleUri: string;
  /** `webview.asWebviewUri(…/dashboard.js | sidebar.js)`. */
  scriptUri: string;
  title: string;
}

export function renderWebviewHtml(o: WebviewHtmlOptions): string {
  const csp = escapeHtml(contentSecurityPolicy(o.cspSource, o.nonce));
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(o.title)}</title>`,
    `<link rel="stylesheet" href="${escapeHtml(o.styleUri)}">`,
    "</head>",
    "<body>",
    '<div id="root"></div>',
    `<script nonce="${escapeHtml(o.nonce)}" src="${escapeHtml(o.scriptUri)}"></script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** Points `webview` at one of the webview bundles under `assetsRoot` with a fresh nonce. */
export function loadWebview(
  webview: Pick<vscode.Webview, "cspSource" | "asWebviewUri" | "html">,
  assetsRoot: vscode.Uri,
  script: "dashboard.js" | "sidebar.js",
): void {
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, name));
  webview.html = renderWebviewHtml({
    cspSource: webview.cspSource,
    nonce: createNonce(),
    styleUri: asset("theme.css").toString(),
    scriptUri: asset(script).toString(),
    title: "EM OS",
  });
}
