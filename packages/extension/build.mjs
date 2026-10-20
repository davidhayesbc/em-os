// Bundles the extension host code: src/extension.ts -> dist/extension.js (CommonJS, node).
//
// `vscode` is provided by the host at runtime and stays external; everything else (including
// @emos/api-contract and zod) is bundled so the extension needs no node_modules at runtime.
// Packaging the VSIX (webview assets, service bundle, Node runtime under dist/) is P0-15; in a
// development host those are resolved from the workspace packages instead (see src/runtime.ts).
import { rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const cwd = process.cwd();

rmSync(join(cwd, "dist"), { recursive: true, force: true });

await build({
  entryPoints: { extension: join(cwd, "src", "extension.ts") },
  outdir: join(cwd, "dist"),
  bundle: true,
  platform: "node",
  format: "cjs",
  // The extension host is Electron's Node (20.x for VS Code 1.95), not the Node 24 toolchain.
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
});
