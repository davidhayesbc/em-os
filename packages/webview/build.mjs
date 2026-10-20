// Browser bundles for the VS Code webviews (the shared scripts/build.mjs targets node).
//
//   src/main.tsx          -> dist/dashboard.js  (IIFE, loaded with a nonce'd <script>)
//   src/sidebar-main.tsx  -> dist/sidebar.js    (IIFE)
//   src/theme.css         -> dist/theme.css
//
// Everything is bundled (no runtime imports, no eval) so it runs under the strict webview CSP.
// Minified unless NODE_ENV=development, which also emits linked sourcemaps.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const cwd = process.cwd();
const dev = process.env.NODE_ENV === "development";

rmSync(join(cwd, "dist"), { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: "browser",
  target: "es2022",
  minify: !dev,
  sourcemap: dev ? "linked" : false,
  outdir: join(cwd, "dist"),
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  logLevel: "info",
};

await build({
  ...shared,
  format: "iife",
  entryPoints: {
    dashboard: join(cwd, "src", "main.tsx"),
    sidebar: join(cwd, "src", "sidebar-main.tsx"),
  },
  define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
});

await build({
  ...shared,
  entryPoints: { theme: join(cwd, "src", "theme.css") },
});
