// Per-package build driver. Run from a workspace directory (npm run build -w <pkg>
// does this): `node ../../scripts/build.mjs`.
//
// 1. esbuild bundles `src/index.ts` -> `dist/index.js` (ESM, node24, sourcemaps), plus
//    `src/main.ts` -> `dist/main.js` when a package has a runnable entry point (the service).
//    Code shared between entries goes into a chunk. Dependencies stay external (not bundled).
// 2. `tsc --emitDeclarationOnly` writes `dist/index.d.ts` using the package tsconfig.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { build } from "esbuild";

const cwd = process.cwd();
const require = createRequire(import.meta.url);

rmSync(join(cwd, "dist"), { recursive: true, force: true });

const entryPoints = ["index", "main"]
  .map((name) => join(cwd, "src", `${name}.ts`))
  .filter((file) => existsSync(file));

await build({
  entryPoints,
  outdir: join(cwd, "dist"),
  splitting: true,
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
});

const tsc = require.resolve("typescript/bin/tsc");
const result = spawnSync(
  process.execPath,
  [tsc, "-p", "tsconfig.json", "--emitDeclarationOnly", "--declaration", "--outDir", "dist"],
  { cwd, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
