// Builds the platform-specific VSIX: `node scripts/package.mjs [--target darwin-arm64|win32-x64]`
// (default: this machine). Run `npm run build` first; this script only assembles and packages.
//
// Staging layout (`.package/<target>/`, git-ignored), which becomes the VSIX `extension/`:
//   package.json, LICENSE, media/        manifest (no scripts/deps) and the activity-bar icon
//   dist/extension.js                    the extension host bundle (build.mjs)
//   dist/webview/                        @emos/webview's dist (dashboard.js, sidebar.js, theme.css)
//   dist/service/main.js                 the service, bundled from source with every workspace
//                                        package and zod inlined (reporting the extension's
//                                        version); only @napi-rs/keyring stays external
//   dist/service/node_modules/@napi-rs/  keyring + the target's prebuilt binary package only
//   dist/runtime/node(.exe)              the official Node binary (node-runtime.json), verified
//                                        against the pin and SHASUMS256.txt, never modified
//
// Downloads are cached under `<repo>/.cache/` (git-ignored). Any checksum mismatch fails.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  assertSingleTarget,
  expectedArchiveSha256,
  parseShasums,
  parseTargetArg,
  serviceBundleOptions,
  sha256File,
  TARGETS,
  verifySha256,
  vsixFileName,
} from "./package-lib.mjs";

const extDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(extDir));
const require = createRequire(join(extDir, "package.json"));
const NODE_DIST = "https://nodejs.org/dist";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const log = (msg) => process.stdout.write(`package: ${msg}\n`);

/** Every file under `dir`, `/`-separated and relative to it. */
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

function run(command, args, opts = {}) {
  const r = spawnSync(command, args, { stdio: "inherit", ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${r.status}`);
}

/** npm through the running npm CLI script when invoked via `npm run` (no npm.cmd on Windows). */
function runNpm(args, opts) {
  const npm = process.env.npm_execpath;
  if (npm?.endsWith(".js") || npm?.endsWith(".cjs")) run(process.execPath, [npm, ...args], opts);
  else run("npm", args, { ...opts, shell: process.platform === "win32" });
}

async function download(url, file) {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`GET ${url} failed: ${res.status}`);
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
  renameSync(part, file);
}

function requireBuilt(file, what) {
  if (!existsSync(file)) throw new Error(`${what} not found at ${file} (run \`npm run build\`)`);
  return file;
}

/** The official Node binary for `target`, checksum-verified; returns its path in the cache. */
async function fetchNodeRuntime(target) {
  const t = TARGETS[target];
  const pin = readJson(join(extDir, "node-runtime.json"));
  const version = pin.version;
  const cache = join(repoRoot, ".cache", "node-runtime", `v${version}`);
  const shasumsFile = join(cache, "SHASUMS256.txt");
  if (!existsSync(shasumsFile))
    await download(`${NODE_DIST}/v${version}/SHASUMS256.txt`, shasumsFile);
  const archive = t.nodeArchive(version);
  const expected = expectedArchiveSha256(
    pin,
    archive,
    parseShasums(readFileSync(shasumsFile, "utf8")),
  );

  const archiveFile = join(cache, archive);
  if (existsSync(archiveFile) && (await sha256File(archiveFile)) !== expected) {
    log(`cached ${archive} has the wrong checksum; downloading again`);
    rmSync(archiveFile);
  }
  if (!existsSync(archiveFile)) await download(`${NODE_DIST}/v${version}/${archive}`, archiveFile);
  await verifySha256(archiveFile, expected); // fail closed
  log(`verified ${archive} sha256 ${expected}`);

  const extractDir = join(cache, `extract-${target}`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  // bsdtar reads both .tar.xz and .zip. On Windows use the system bsdtar, not Git's GNU tar.
  const tar =
    process.platform === "win32"
      ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
      : "tar";
  run(tar, ["-xf", archiveFile, "-C", extractDir, t.nodeMember(version)]);
  const binary = join(extractDir, ...t.nodeMember(version).split("/"));
  if (!existsSync(binary)) throw new Error(`${t.nodeMember(version)} missing from ${archive}`);
  return { binary, version };
}

/** `@napi-rs/keyring` + only `target`'s binary package, installed into a throwaway prefix. */
function fetchKeyring(target, version) {
  const t = TARGETS[target];
  const prefix = join(repoRoot, ".cache", "keyring", `${target}-${version}`);
  rmSync(prefix, { recursive: true, force: true });
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, "package.json"), '{ "private": true }\n');
  runNpm([
    "install",
    "--no-save",
    "--no-package-lock",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `--os=${t.npmOs}`,
    `--cpu=${t.npmCpu}`,
    "--prefix",
    prefix,
    `@napi-rs/keyring@${version}`,
  ]);
  const scope = join(prefix, "node_modules", "@napi-rs");
  const installed = readdirSync(scope).map((n) => `@napi-rs/${n}`);
  const want = ["@napi-rs/keyring", t.keyringPackage];
  if (installed.sort().join() !== want.sort().join()) {
    throw new Error(
      `${target}: expected ${want.join(" + ")}, npm installed ${installed.join(", ")}`,
    );
  }
  for (const pkg of want) {
    const v = readJson(join(prefix, "node_modules", ...pkg.split("/"), "package.json")).version;
    if (v !== version) throw new Error(`${pkg} is ${v}, expected ${version}`);
  }
  return scope;
}

async function main() {
  const target = parseTargetArg(process.argv.slice(2), process.platform, process.arch);
  const t = TARGETS[target];
  const manifest = readJson(join(extDir, "package.json"));
  const serviceMain = requireBuilt(require.resolve("@emos/service/main"), "service bundle");
  // `@emos/service/main` is `<pkg>/dist/main.js`; the package exports no `./package.json`.
  const keyringVersion = readJson(join(dirname(dirname(serviceMain)), "package.json")).dependencies[
    "@napi-rs/keyring"
  ];
  if (!/^\d+\.\d+\.\d+$/.test(keyringVersion ?? "")) {
    throw new Error(`@emos/service must pin @napi-rs/keyring exactly (found ${keyringVersion})`);
  }

  const extensionJs = requireBuilt(join(extDir, "dist", "extension.js"), "extension bundle");
  const webviewDist = join(dirname(require.resolve("@emos/webview/package.json")), "dist");
  requireBuilt(join(webviewDist, "dashboard.js"), "webview bundle");

  const stage = join(extDir, ".package", target);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "dist"), { recursive: true });
  log(`staging ${target} in ${relative(repoRoot, stage)}`);

  const { scripts, dependencies, devDependencies, ...vsixManifest } = manifest;
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(vsixManifest, null, 2)}\n`);
  copyFileSync(join(repoRoot, "LICENSE"), join(stage, "LICENSE"));
  copyFileSync(join(extDir, ".vscodeignore"), join(stage, ".vscodeignore"));
  cpSync(join(extDir, "media"), join(stage, "media"), { recursive: true });
  copyFileSync(extensionJs, join(stage, "dist", "extension.js"));
  cpSync(webviewDist, join(stage, "dist", "webview"), { recursive: true });

  // The service: one ESM file with the workspace packages inlined (their dist/ is ESM), built
  // from source so it reports the extension's version (see serviceBundleOptions).
  const serviceDir = join(stage, "dist", "service");
  await build(
    serviceBundleOptions({
      entry: join(dirname(dirname(serviceMain)), "src", "main.ts"),
      outfile: join(serviceDir, "main.js"),
      version: manifest.version,
    }),
  );
  writeFileSync(join(serviceDir, "package.json"), '{ "type": "module" }\n');
  const scope = fetchKeyring(target, keyringVersion);
  cpSync(scope, join(serviceDir, "node_modules", "@napi-rs"), { recursive: true });

  const { binary, version: nodeVersion } = await fetchNodeRuntime(target);
  const runtime = join(stage, "dist", "runtime", t.runtimeName);
  mkdirSync(dirname(runtime), { recursive: true });
  copyFileSync(binary, runtime);
  if (process.platform !== "win32") chmodSync(runtime, 0o755); // mode only; bytes untouched
  if ((await sha256File(runtime)) !== (await sha256File(binary))) {
    throw new Error("Node runtime changed while copying");
  }

  assertSingleTarget(listFiles(stage), target);

  const vsix = join(extDir, vsixFileName(target, manifest.version));
  rmSync(vsix, { force: true });
  const vsce = join(dirname(require.resolve("@vscode/vsce/package.json")), "vsce");
  // `vsce ls` prints exactly what goes into the VSIX: assert one platform there too.
  const ls = spawnSync(process.execPath, [vsce, "ls", "--no-dependencies"], {
    cwd: stage,
    encoding: "utf8",
  });
  if (ls.status !== 0) throw new Error(`vsce ls failed:\n${ls.stderr}`);
  assertSingleTarget(
    ls.stdout.split(/\r?\n/).filter((l) => l.trim() !== ""),
    target,
  );
  run(process.execPath, [vsce, "package", "--target", target, "--no-dependencies", "--out", vsix], {
    cwd: stage,
  });
  const mb = (statSync(vsix).size / 1024 / 1024).toFixed(1);
  log(
    `${relative(repoRoot, vsix)} (${mb} MB; Node ${nodeVersion}, @napi-rs/keyring ${keyringVersion})`,
  );
}

main().catch((e) => {
  process.stderr.write(`package: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
