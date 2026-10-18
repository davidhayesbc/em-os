#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const script = resolve(root, "scripts/test-packaged-vsix.mjs");
const fakeBase = mkdtempSync(resolve(tmpdir(), "vsix-smoke-fake-"));
const fakeCode = resolve(fakeBase, "code");
const fakeBinDir = resolve(fakeBase, "bin");
const fakeBinCode = resolve(fakeBinDir, "code");
const fakeVsix = resolve(fakeBase, "fake.vsix");

function makeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function runCase(label, env, expectZero) {
  console.log(`\n=== ${label} ===`);
  const childEnv = {
    ...process.env,
    VSCODE_EXECUTABLE_PATH: fakeCode,
    VSIX_PATH: fakeVsix,
    ...env,
  };
  let status;
  let signal;
  let stdout = "";
  let stderr = "";
  try {
    const result = execFileSync(process.execPath, [script], {
      cwd: root,
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    stdout = result;
    status = 0;
  } catch (error) {
    status = error.status ?? 1;
    signal = error.signal;
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? "";
  }
  console.log(stdout);
  if (stderr) console.error(stderr);
  const passed = expectZero ? status === 0 : status !== 0;
  const expectation = expectZero ? "exit 0" : "exit non-zero";
  console.log(`Result: ${passed ? "PASS" : "FAIL"} (status=${status}${signal ? ` signal=${signal}` : ""}, expected ${expectation})`);
  if (!passed) {
    throw new Error(`${label} failed: expected ${expectation}, got status=${status}${signal ? ` signal=${signal}` : ""}`);
  }
  return { status, stdout, stderr };
}

rmSync(fakeBase, { recursive: true, force: true });
mkdirSync(fakeBinDir, { recursive: true });
writeFileSync(fakeVsix, "", "utf8");

// Fake Electron/VS Code: executable used by @vscode/test-electron's runTests.
// When launched with --extensionTestsPath it emits the requested subset of
// success markers, then either segfaults or exits 1 depending on FAKE_EXIT_MODE.
makeExecutable(
  fakeCode,
  `#!/bin/sh
if echo "$*" | grep -q -- "--extensionTestsPath"; then
  [ -n "$FAKE_OMIT_MARKER" ] || echo "[packaged-vsix-smoke] invoked em-os.sync"
  echo "[packaged-vsix-smoke] invoked em-os.openInbox"
  echo "[packaged-vsix-smoke] invoked em-os.whatNext"
  echo "[packaged-vsix-smoke] invoked em-os.draftWeeklyUpdate"
  [ -n "$FAKE_OMIT_MARKER" ] || echo "[packaged-vsix-smoke] invoked em-os.captureEvidence"
  echo "Extension host test runner exit code: 0"
  echo "Asking native host service to exit with code 0."
  if [ "$FAKE_EXIT_MODE" = "segfault" ]; then
    kill -SEGV $$
  fi
  exit 1
fi
exit 0
`,
);

// Fake VS Code: CLI executable used for --install-extension and --list-extensions.
makeExecutable(
  fakeBinCode,
  `#!/bin/sh
if echo "$*" | grep -q -- "--list-extensions"; then
  echo "em-os.em-os-vscode@0.1.0"
fi
exit 0
`,
);

let failed = false;

try {
  // Case 1: all markers + child SIGSEGV -> PASS (teardown flake relaxation).
  runCase("Case 1: all markers then child SIGSEGV", { FAKE_EXIT_MODE: "segfault" }, true);

  // Case 2: all markers + child exit 1 without SIGSEGV -> FAIL.
  runCase("Case 2: all markers then child exit 1 (no SIGSEGV)", { FAKE_EXIT_MODE: "error" }, false);

  // Case 3: missing captureEvidence marker + child SIGSEGV -> FAIL with missing-marker diagnostics.
  const case3 = runCase("Case 3: missing captureEvidence marker then child SIGSEGV", { FAKE_EXIT_MODE: "segfault", FAKE_OMIT_MARKER: "1" }, false);
  if (!case3.stdout.includes("missing marker: [packaged-vsix-smoke] invoked em-os.captureEvidence") && !case3.stderr.includes("missing marker: [packaged-vsix-smoke] invoked em-os.captureEvidence")) {
    throw new Error("Case 3 did not emit the expected missing-marker diagnostic");
  }

  // Case 4: VSCODE_SMOKE_STATE outside repo with all markers + SIGSEGV -> PASS.
  const stateOutside = mkdtempSync(resolve(tmpdir(), "vsix-smoke-state-outside-"));
  runCase("Case 4: VSCODE_SMOKE_STATE outside repo", { FAKE_EXIT_MODE: "segfault", VSCODE_SMOKE_STATE: stateOutside }, true);
  rmSync(stateOutside, { recursive: true, force: true });
} catch (error) {
  console.error(`\nSelf-test failed: ${error.message}`);
  failed = true;
} finally {
  rmSync(fakeBase, { recursive: true, force: true });
}

if (failed) {
  process.exit(1);
}

console.log("\nAll packaged-VSIX smoke self-test cases passed.");
