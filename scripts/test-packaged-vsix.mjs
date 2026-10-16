import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "..");
const version = process.env.VSCODE_VERSION ?? "1.105.1";
const vsix = resolve(process.env.VSIX_PATH ?? resolve(root, "artifacts/em-os-vscode.vsix"));
const stateRoot = resolve(process.env.VSCODE_SMOKE_STATE ?? resolve(root, ".vscode-test/packaged-vsix-smoke"));
const userDataDir = resolve(stateRoot, "user-data");
const extensionsDir = resolve(stateRoot, "extensions");
const logsDir = resolve(stateRoot, "logs");
const expected = "em-os.em-os-vscode@0.1.0";

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
    throw new Error(`VS Code CLI failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout ?? "";
}

const isolatedArgs = ["--user-data-dir", userDataDir, "--extensions-dir", extensionsDir, "--disable-gpu"];
console.log(`Installing ${vsix} with VS Code ${version}`);
codeCli([...isolatedArgs, "--install-extension", vsix, "--force"]);
const installed = codeCli([...isolatedArgs, "--list-extensions", "--show-versions"], true)
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean);
assert.deepEqual(installed, [expected], `isolated extension inventory must contain only ${expected}`);
console.log(`Verified isolated inventory: ${installed.join(", ")}`);

console.log(`Extension Host logs: ${logsDir}`);
await runTests({
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
});
console.log("Packaged VSIX Extension Host smoke passed.");
