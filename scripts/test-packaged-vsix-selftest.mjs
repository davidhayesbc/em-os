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
const stateDirs = [];

function makeExecutable(path, body) {
  writeFileSync(path, body, { mode: 0o755 });
}

function makeStateDir() {
  const dir = mkdtempSync(resolve(tmpdir(), "vsix-smoke-state-"));
  stateDirs.push(dir);
  return dir;
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
// success markers, then either segfaults or exits depending on FAKE_EXIT_MODE.
// The "Extension host test runner exit code:" line is printed only when $CI is
// set, matching the pinned VS Code runtime behaviour (the line is CI-only).
makeExecutable(
  fakeCode,
  `#!/bin/sh
if echo "$*" | grep -q -- "--extensionTestsPath"; then
  : "\${FAKE_EXIT_CODE:=0}"
  [ -n "$FAKE_OMIT_SYNC" ] || echo "[packaged-vsix-smoke] invoked em-os.sync"
  echo "[packaged-vsix-smoke] invoked em-os.openInbox"
  echo "[packaged-vsix-smoke] invoked em-os.whatNext"
  echo "[packaged-vsix-smoke] invoked em-os.draftWeeklyUpdate"
  [ -n "$FAKE_OMIT_CAPTURE" ] || echo "[packaged-vsix-smoke] invoked em-os.captureEvidence"
  if [ -n "$CI" ]; then
    echo "Extension host test runner exit code: $FAKE_EXIT_CODE"
  fi
  echo "Asking native host service to exit with code $FAKE_EXIT_CODE."
  case "$FAKE_EXIT_MODE" in
    segfault)
      kill -SEGV $$
      ;;
    success)
      exit 0
      ;;
    error2)
      exit 2
      ;;
  esac
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
  runCase(
    "Case 1: all markers then child SIGSEGV",
    { FAKE_EXIT_MODE: "segfault", VSCODE_SMOKE_STATE: makeStateDir() },
    true,
  );

  // Case 2: all markers + child exit 1 without SIGSEGV -> FAIL.
  runCase(
    "Case 2: all markers then child exit 1 (no SIGSEGV)",
    { FAKE_EXIT_MODE: "error", VSCODE_SMOKE_STATE: makeStateDir() },
    false,
  );

  // Case 3: missing captureEvidence marker + child SIGSEGV -> FAIL with missing-marker diagnostics.
  const case3 = runCase(
    "Case 3: missing captureEvidence marker then child SIGSEGV",
    { FAKE_EXIT_MODE: "segfault", FAKE_OMIT_CAPTURE: "1", VSCODE_SMOKE_STATE: makeStateDir() },
    false,
  );
  if (
    !case3.stdout.includes("missing marker: [packaged-vsix-smoke] invoked em-os.captureEvidence") &&
    !case3.stderr.includes("missing marker: [packaged-vsix-smoke] invoked em-os.captureEvidence")
  ) {
    throw new Error("Case 3 did not emit the expected missing-marker diagnostic");
  }

  // Case 4: VSCODE_SMOKE_STATE outside repo with all markers + SIGSEGV -> PASS.
  runCase(
    "Case 4: VSCODE_SMOKE_STATE outside repo",
    { FAKE_EXIT_MODE: "segfault", VSCODE_SMOKE_STATE: makeStateDir() },
    true,
  );

  // Case 5: non-CI success. Outer CI is unset, the runner injects CI=1 so the
  // CI-only exit-code marker appears, all command markers are present, and the
  // child exits 0 -> PASS. This is the regression guard for local runs.
  runCase(
    "Case 5: non-CI success (CI marker injected by runner)",
    { FAKE_EXIT_MODE: "success", CI: "", VSCODE_SMOKE_STATE: makeStateDir() },
    true,
  );

  // Case 6: all markers + child exit 2 without SIGSEGV -> FAIL.
  runCase(
    "Case 6: all markers then child exit 2 (no SIGSEGV)",
    { FAKE_EXIT_MODE: "error2", CI: "1", VSCODE_SMOKE_STATE: makeStateDir() },
    false,
  );

  // Case 7: exit-code marker 1 + child SIGSEGV -> FAIL (bad exit code must not
  // be masked by the teardown segfault relaxation).
  runCase(
    "Case 7: exit-code marker 1 then child SIGSEGV",
    { FAKE_EXIT_MODE: "segfault", CI: "1", FAKE_EXIT_CODE: "1", VSCODE_SMOKE_STATE: makeStateDir() },
    false,
  );
} catch (error) {
  console.error(`\nSelf-test failed: ${error.message}`);
  failed = true;
} finally {
  rmSync(fakeBase, { recursive: true, force: true });
  for (const dir of stateDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failed) {
  process.exit(1);
}

console.log("\nAll packaged-VSIX smoke self-test cases passed.");
