import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "..");
const version = process.env.VSCODE_VERSION ?? "1.105.1";
const vsix = resolve(process.env.VSIX_PATH ?? resolve(root, "artifacts/em-os-vscode.vsix"));
const stateRoot = resolve(process.env.VSCODE_SMOKE_STATE ?? resolve(root, ".vscode-test/packaged-vsix-smoke"));
const userDataDir = resolve(stateRoot, "user-data");
const extensionsDir = resolve(stateRoot, "extensions");
const logsDir = resolve(stateRoot, "logs");
const expected = "em-os.em-os-vscode@0.1.0";

const successMarkers = [
  "Verified isolated inventory: em-os.em-os-vscode@0.1.0",
  "[packaged-vsix-smoke] invoked em-os.sync",
  "[packaged-vsix-smoke] invoked em-os.openInbox",
  "[packaged-vsix-smoke] invoked em-os.whatNext",
  "[packaged-vsix-smoke] invoked em-os.draftWeeklyUpdate",
  "[packaged-vsix-smoke] invoked em-os.captureEvidence",
  "Extension host test runner exit code: 0",
];

/**
 * Known environmental flake: headless Electron under Xvfb occasionally segfaults
 * during process teardown *after* the extension-host harness has already logged
 * success. The marker check below only relaxes the final exit-code judgement
 * when every explicit success marker has been observed; missing markers or
 * assertion failures still fail the job.
 */
function hasAllMarkers(output) {
  return successMarkers.every((marker) => output.includes(marker));
}

function isTeardownSegfault(result) {
  if (result.signal === "SIGSEGV") return true;
  const message = String(result.error ?? "");
  return /SIGSEGV|signal SIGSEGV|Test run terminated with signal/i.test(message);
}

rmSync(stateRoot, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });
mkdirSync(extensionsDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });

const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH
  ? resolve(process.env.VSCODE_EXECUTABLE_PATH)
  : await downloadAndUnzipVSCode({ version, cachePath: resolve(root, ".vscode-test") });
const [cli, ...resolvedCliPrefix] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
const cliPrefix = resolvedCliPrefix.filter(
  (argument) => !argument.startsWith("--user-data-dir") && !argument.startsWith("--extensions-dir"),
);

function codeCli(args, capture = false) {
  const result = spawnSync(cli, [...cliPrefix, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DONT_PROMPT_WSL_INSTALL: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`VS Code: CLI failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout ?? "";
}

const isolatedArgs = ["--user-data-dir", userDataDir, "--extensions-dir", extensionsDir, "--disable-gpu"];
console.log(`Installing ${vsix} with VS Code: ${version}`);
codeCli([...isolatedArgs, "--install-extension", vsix, "--force"]);
const installed = codeCli([...isolatedArgs, "--list-extensions", "--show-versions"], true)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean);
assert.deepEqual(installed, [expected], `isolated extension inventory must contain only ${expected}`);
console.log(`Verified isolated inventory: ${installed.join(", ")}`);

console.log(`Extension Host logs: ${logsDir}`);

const runOptions = {
  vscodeExecutablePath,
  extensionDevelopmentPath: resolve(root, "test/vscode-smoke/harness"),
  extensionTestsPath: resolve(root, "test/vscode-smoke/suite/index.js"),
  launchArgs: [
    resolve(root, "test/vscode-smoke/workspace"),
    ...isolatedArgs,
    "--logsPath", logsDir,
    "--disable-workspace-trust",
    "--disable-telemetry",
    "--skip-release-notes",
    "--skip-welcome",
  ],
  extensionTestsEnv: {
    EM_OS_EXPECTED_EXTENSION: "em-os.em-os-vscode",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
  },
};

const runnerScript = resolve(stateRoot, "electron-runner.mjs");
const runnerOptionsPath = resolve(stateRoot, "electron-runner-options.json");
writeFileSync(
  runnerScript,
  `import { runTests } from "@vscode/test-electron";\nimport { readFileSync } from "node:fs";\nconst options = JSON.parse(readFileSync(process.argv[2], "utf8"));\nawait runTests(options);\n`,
  "utf8"
);
writeFileSync(runnerOptionsPath, JSON.stringify(runOptions, null, 2), "utf8");

const { once } = await import("node:events");

const result = await new Promise((resolvePromise, rejectPromise) => {
  let output = "";
  const child = spawn(process.execPath, [runnerScript, runnerOptionsPath], {
    cwd: root,
    env: {
      ...process.env,
      DONT_PROMPT_WSL_INSTALL: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });

  child.on("error", (error) => {
    rejectPromise(error);
  });

  Promise.all([once(child.stdout, "end"), once(child.stderr, "end"), once(child, "close")])
    .then(([_, __, [code, signal]]) => {
      resolvePromise({ ok: code === 0 && signal === null, code, signal, output, error: null });
    })
    .catch(rejectPromise);
});

const allMarkers = hasAllMarkers(result.output);

if (!result.ok) {
  if (allMarkers && isTeardownSegfault(result)) {
    console.warn(
      "[packaged-vsix-smoke] Electron teardown segfault detected after all success markers were observed. Treating as PASS because the harness itself succeeded."
    );
    console.warn(`[packaged-vsix-smoke] child exit: code=${result.code}, signal=${result.signal}`);
  } else {
    if (!allMarkers) {
      console.error("[packaged-vsix-smoke] missing success markers; this is a real failure, not a teardown flake.");
      for (const marker of successMarkers) {
        if (!result.output.includes(marker)) {
          console.error(`[packaged-vsix-smoke] missing marker: ${marker}`);
        }
      }
    }
    if (result.error) throw result.error;
    const exitSummary = result.signal
      ? `terminated by signal ${result.signal}`
      : `exited with code ${result.code}`;
    throw new Error(`Electron smoke runner ${exitSummary}.`);
  }
} else if (!allMarkers) {
  throw new Error("Electron smoke runner completed without error but required success markers were not observed.");
}

console.log("Packaged VSIX Extension Host smoke passed.");