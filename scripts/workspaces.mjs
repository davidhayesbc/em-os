// Builds the workspace packages in dependency order (root `npm run build`).
//
// `npm run build --workspaces` runs packages alphabetically, but each package's build emits
// declarations with tsc, which resolves `@emos/*` imports through the dependency's `dist/`.
// On a fresh checkout a package that sorts before its dependency (e.g. service before
// store-sqlite) would fail, so the order comes from package.json dependencies instead.
//
// CLI: `node scripts/workspaces.mjs` (run from the repo root).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Topological order of workspace package names: every package after the workspace packages in
 * its `dependencies`, `devDependencies` and `peerDependencies`. Ties break alphabetically so
 * the order is deterministic. Throws on a cycle.
 * @param {Array<{ name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>} pkgs
 * @returns {string[]}
 */
export function buildOrder(pkgs) {
  const names = new Set(pkgs.map((p) => p.name));
  const deps = new Map(
    pkgs.map((p) => [
      p.name,
      [
        ...Object.keys(p.dependencies ?? {}),
        ...Object.keys(p.devDependencies ?? {}),
        ...Object.keys(p.peerDependencies ?? {}),
      ].filter((d) => names.has(d) && d !== p.name),
    ]),
  );
  const order = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (name, path) => {
    if (done.has(name)) return;
    if (visiting.has(name))
      throw new Error(`Workspace dependency cycle: ${[...path, name].join(" -> ")}`);
    visiting.add(name);
    for (const d of [...(deps.get(name) ?? [])].sort()) visit(d, [...path, name]);
    visiting.delete(name);
    done.add(name);
    order.push(name);
  };
  for (const name of [...names].sort()) visit(name, []);
  return order;
}

function main() {
  const root = process.cwd();
  const pkgs = readdirSync(join(root, "packages"))
    .map((d) => join(root, "packages", d, "package.json"))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, "utf8")));
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  // `npm run` sets npm_execpath to npm's CLI script; running it with node avoids `npm.cmd` on Windows.
  const npm = process.env.npm_execpath;
  for (const name of buildOrder(pkgs)) {
    if (!byName.get(name)?.scripts?.build) continue;
    const args = ["run", "build", "-w", name];
    const r = npm
      ? spawnSync(process.execPath, [npm, ...args], { stdio: "inherit" })
      : spawnSync("npm", args, { stdio: "inherit", shell: process.platform === "win32" });
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}

function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main();
}
