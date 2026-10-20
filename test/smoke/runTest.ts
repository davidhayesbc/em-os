// Extension smoke test (`npm run smoke`, after `npm run package`): installs this platform's
// em-os VSIX into a throwaway VS Code profile, launches VS Code (stable, downloaded into the
// git-ignored `.vscode-test/`) and runs `suite/` in its extension host.
//
// Isolation: temp `--user-data-dir`, `--extensions-dir` and `EMOS_DATA_DIR`; the service uses
// the in-memory secret store (`EMOS_SECRET_STORE=memory`), so the real keychain and real data
// dir are never touched. The service is detached, so it is stopped (SIGTERM) afterwards.
//
// Run with Node 24+ (type stripping): `node test/smoke/runTest.ts`.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";
import { build } from "esbuild";
import { hostTarget, vsixFileName } from "../../packages/extension/scripts/package-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(dirname(here));
const cachePath = join(repoRoot, ".vscode-test");
const isWindows = process.platform === "win32";

const log = (msg: string) => process.stdout.write(`smoke: ${msg}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The service's command line (to prove it runs on the VSIX's bundled Node). */
function commandLine(pid: number): string {
  const r = isWindows
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: "utf8" },
      )
    : spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

/** Strip anything that could point the child VS Code at the user's real one or a dev Node. */
function isolateEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (/^(VSCODE_|ELECTRON_)/.test(key)) delete process.env[key];
  }
  for (const key of [
    "EMOS_NODE_PATH",
    "EMOS_TEST_KEYCHAIN",
    "EMOS_DATA_DIR",
    "EMOS_SECRET_STORE",
  ]) {
    delete process.env[key];
  }
}

/** A minimal development extension that only hosts the test suite (bundled to CommonJS). */
async function buildHarness(): Promise<string> {
  const harness = join(repoRoot, ".cache", "smoke", "harness");
  rmSync(harness, { recursive: true, force: true });
  mkdirSync(harness, { recursive: true });
  writeFileSync(
    join(harness, "package.json"),
    `${JSON.stringify(
      {
        name: "emos-smoke-harness",
        publisher: "emos-dev",
        version: "0.0.0",
        private: true,
        engines: { vscode: "^1.95.0" },
      },
      null,
      2,
    )}\n`,
  );
  await build({
    entryPoints: [join(here, "suite", "index.ts")],
    outfile: join(harness, "suite.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    logLevel: "warning",
  });
  return harness;
}

function installVsix(vscodeExecutablePath: string, vsix: string, profile: string[]): void {
  const [cli] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
  if (!cli) throw new Error("VS Code CLI not found");
  const args = [...profile, "--install-extension", vsix, "--force"];
  // The CLI is a .cmd on Windows: it needs a shell, so quote every argument (CVE-2024-27980).
  const r = isWindows
    ? spawnSync(
        `"${cli}"`,
        args.map((a) => `"${a}"`),
        { stdio: "inherit", shell: true },
      )
    : spawnSync(cli, args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Installing ${vsix} failed (exit ${r.status})`);
}

/** SIGTERM the service from `service.json`; SIGKILL if it hasn't exited after 10 s. */
async function stopService(dataDir: string): Promise<number | undefined> {
  let pid: number | undefined;
  try {
    pid = JSON.parse(readFileSync(join(dataDir, "run", "service.json"), "utf8")).pid;
  } catch {
    return undefined;
  }
  if (typeof pid !== "number" || !isAlive(pid)) return undefined;
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + 10_000;
  while (isAlive(pid) && Date.now() < deadline) await sleep(100);
  if (isAlive(pid)) process.kill(pid, "SIGKILL");
  return pid;
}

async function main(): Promise<number> {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "packages", "extension", "package.json"), "utf8"),
  );
  const target = hostTarget(process.platform, process.arch);
  const vsix = join(repoRoot, "packages", "extension", vsixFileName(target, manifest.version));
  if (!existsSync(vsix)) throw new Error(`${vsix} not found (run \`npm run package\`)`);

  isolateEnv();
  const work = mkdtempSync(join(realpathSync(tmpdir()), "emos-smoke-"));
  const dataDir = join(work, "data");
  const profile = [
    `--extensions-dir=${join(work, "extensions")}`,
    `--user-data-dir=${join(work, "user-data")}`,
  ];
  let failed = false;
  try {
    const harness = await buildHarness();
    // EMOS_SMOKE_VSCODE_PATH: use an already-installed VS Code executable instead of downloading
    // (still with the throwaway profile above). Default: stable, cached in .vscode-test/.
    const vscodeExecutablePath =
      process.env.EMOS_SMOKE_VSCODE_PATH ||
      (await downloadAndUnzipVSCode({ version: "stable", cachePath, timeout: 120_000 }));
    log(`installing ${vsixFileName(target, manifest.version)} into a clean profile in ${work}`);
    installVsix(vscodeExecutablePath, vsix, profile);

    try {
      await runTests({
        vscodeExecutablePath,
        extensionDevelopmentPath: harness,
        extensionTestsPath: join(harness, "suite.js"),
        launchArgs: [...profile, "--disable-gpu", "--disable-telemetry", "--new-window"],
        extensionTestsEnv: {
          EMOS_DATA_DIR: dataDir,
          EMOS_SECRET_STORE: "memory",
          EMOS_TEST_HOOKS: "1",
        },
      });
    } catch (e) {
      failed = true;
      log(`extension-host suite failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // The service outlives VS Code: check it runs on the VSIX's own Node, not a PATH node.
    const info = JSON.parse(readFileSync(join(dataDir, "run", "service.json"), "utf8"));
    const cmd = commandLine(info.pid);
    const runtime = `${sep}dist${sep}runtime${sep}node`;
    if (cmd.includes("emos-dev.em-os-") && cmd.includes(runtime)) {
      log(`service pid ${info.pid} runs on the bundled runtime`);
    } else {
      failed = true;
      log(`service pid ${info.pid} is not on the bundled runtime: ${cmd || "(not running)"}`);
    }
  } finally {
    const pid = await stopService(dataDir);
    if (pid !== undefined) log(`stopped service pid ${pid}`);
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      log(`could not remove ${work}: ${(e as Error).message}`); // e.g. a lingering Windows lock
    }
  }
  log(failed ? "FAILED" : "passed");
  return failed ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`smoke: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 1;
  },
);
