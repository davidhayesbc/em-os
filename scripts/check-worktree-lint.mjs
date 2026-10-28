// Regression test for Biome worktree exclusion.
//
// The PR #51 worktree hygiene change originally used `!**/.worktrees`, which
// excludes any path containing a `.worktrees` segment. That silently ignores
// the entire current checkout when the checkout itself lives under a `.worktrees`
// ancestor (e.g. a kanban git worktree), causing `biome check .` to report
// "Checked 0 files" and fail CI.
//
// This script verifies the root-relative `!.worktrees` exclusion instead:
// - a `.worktrees/` directory at the current checkout root is excluded,
//   even when it contains deliberately invalid fixture code;
// - a checkout whose absolute path has `.worktrees` as an ancestor is still
//   linted normally.
//
// CLI: `node scripts/check-worktree-lint.mjs`
// Vitest: `scripts/check-worktree-lint.test.ts` imports the assertion helpers.

import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

// Invoke the package's JavaScript CLI entry directly. On Windows, npm creates
// a shell shim (e.g. `.cmd`) in node_modules/.bin, which cannot be executed by
// process.execPath as a JS module. Using the real bin/biome file plus an
// explicit BIOME_BINARY keeps the call portable across Linux, macOS, and Windows.
const biomeJsEntry = join(repoRoot, "node_modules/@biomejs/biome/bin/biome");

const cleanJs = "const value = 1;\nconsole.log(value);\n";
const uglyJs = "const badlyFormatted=1\n";

function isMusl() {
  if (process.platform !== "linux") {
    return false;
  }
  let stderr;
  try {
    stderr = execSync("ldd --version", { stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    stderr = err.stderr;
  }
  if (stderr?.toString().includes("musl")) {
    return true;
  }
  return false;
}

function resolveBiomeBinary() {
  const { platform, arch } = process;
  const binaryName = platform === "win32" ? "biome.exe" : "biome";
  let platformKey = platform;
  if (platform === "linux") {
    platformKey = isMusl() ? "linux-musl" : "linux";
  }
  const packageName = `@biomejs/cli-${platformKey}-${arch}`;
  return join(repoRoot, "node_modules", packageName, binaryName);
}

const biomeBinary = resolveBiomeBinary();

function runBiome(cwd, args = ["check", "."]) {
  const result = spawnSync(process.execPath, [biomeJsEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, BIOME_BINARY: biomeBinary, FORCE_COLOR: "0", NO_COLOR: "1" },
    shell: false,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function loadRepoBiomeConfig() {
  const config = JSON.parse(readFileSync(join(repoRoot, "biome.json"), "utf8"));
  // The schema path is relative to the repository root, not the temp fixture.
  delete config.$schema;
  return config;
}

function makeConfigVariant(variant) {
  const config = loadRepoBiomeConfig();
  let includes = config.files?.includes ?? ["**"];
  includes = includes.filter(
    (pattern) => pattern !== "!.worktrees" && pattern !== "!**/.worktrees",
  );

  if (variant === "current") {
    includes.push("!.worktrees");
  } else if (variant === "reverted") {
    includes.push("!**/.worktrees");
  } else if (variant === "removed") {
    // intentionally leave worktree exclusion out
  } else {
    throw new Error(`unknown config variant: ${variant}`);
  }

  config.files = { ...config.files, includes };
  return JSON.stringify(config, null, 2);
}

function writeBiomeJson(dir, variant) {
  writeFileSync(join(dir, "biome.json"), makeConfigVariant(variant));
  // Format the copied config so any JSON.stringify differences match Biome's style.
  const { code, stderr } = runBiome(dir, ["format", "--write", "biome.json"]);
  if (code !== 0) {
    throw new Error(`failed to format temp biome.json (${variant}): ${stderr}`);
  }
}

function countProcessedFiles(output) {
  const match = output.match(/Checked\s+(\d+)\s+file/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function assertAtLeast(output, minFiles, label) {
  const count = countProcessedFiles(output);
  if (count < minFiles) {
    throw new Error(
      `${label}: expected at least ${minFiles} file(s) processed, got ${count}.\nOutput:\n${output}`,
    );
  }
  return count;
}

function assertExactly(output, expectedFiles, label) {
  const count = countProcessedFiles(output);
  if (count !== expectedFiles) {
    throw new Error(
      `${label}: expected exactly ${expectedFiles} file(s) processed, got ${count}.\nOutput:\n${output}`,
    );
  }
  return count;
}

function assertOutputDoesNotMention(output, needle, label) {
  if (output.includes(needle)) {
    throw new Error(`${label}: output must not mention ${needle}.\nOutput:\n${output}`);
  }
}

/**
 * Current config in a repo-root checkout: the descendant `.worktrees/` dir is
 * ignored, while root source files are still linted.
 */
export function assertRootCheckoutCurrentConfig() {
  const base = mkdtempSync(join(tmpdir(), "worktree-lint-root-current-"));
  try {
    const checkout = join(base, "repo-root");
    mkdirSync(join(checkout, ".worktrees", "bad-fixture"), { recursive: true });
    writeBiomeJson(checkout, "current");
    writeFileSync(join(checkout, "sample.js"), cleanJs);
    writeFileSync(join(checkout, ".worktrees", "bad-fixture", "bad.js"), uglyJs);

    const result = runBiome(checkout);
    if (result.code !== 0) {
      throw new Error(
        `repo-root checkout with current config should pass, but exited ${result.code}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    assertAtLeast(result.stdout, 1, "repo-root current config");
    assertOutputDoesNotMention(result.stdout, "bad.js", "repo-root current config");
    return true;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * Current config in a checkout whose absolute path contains `.worktrees` as an
 * ancestor: the checkout's own files are still linted.
 */
export function assertNestedCheckoutCurrentConfig() {
  const base = mkdtempSync(join(tmpdir(), "worktree-lint-nested-current-"));
  try {
    const checkout = join(base, ".worktrees", "nested-checkout");
    mkdirSync(checkout, { recursive: true });
    writeBiomeJson(checkout, "current");
    writeFileSync(join(checkout, "sample.js"), cleanJs);

    const result = runBiome(checkout);
    if (result.code !== 0) {
      throw new Error(
        `nested .worktrees checkout with current config should pass, but exited ${result.code}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    assertAtLeast(result.stdout, 1, "nested current config");
    return true;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * Negative control: reverting to the old glob that excludes any path containing
 * a `.worktrees` segment must fail inside a `.worktrees` ancestor checkout,
 * because Biome silently checks 0 files.
 */
export function assertNestedCheckoutRevertedConfigFails() {
  const base = mkdtempSync(join(tmpdir(), "worktree-lint-nested-reverted-"));
  try {
    const checkout = join(base, ".worktrees", "reverted-checkout");
    mkdirSync(checkout, { recursive: true });
    writeBiomeJson(checkout, "reverted");
    writeFileSync(join(checkout, "sample.js"), cleanJs);

    const result = runBiome(checkout);
    const count = countProcessedFiles(result.stdout);

    // The silent failure mode is exit 0 with 0 files checked. Any non-zero exit
    // is also a clear failure. Only a pass with >0 files means the guard is broken.
    if (result.code === 0 && count > 0) {
      throw new Error(
        `reverted !**/.worktrees config unexpectedly passed inside a .worktrees ancestor (checked ${count} files).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    // Ensure the failure is for the intended reason: 0 files were processed.
    assertExactly(result.stdout, 0, "nested reverted config");
    return true;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * Negative control: removing the worktree exclusion entirely must fail in a
 * repo-root checkout because the invalid fixture inside `.worktrees/` is then
 * linted.
 */
export function assertRootCheckoutRemovedConfigFails() {
  const base = mkdtempSync(join(tmpdir(), "worktree-lint-root-removed-"));
  try {
    const checkout = join(base, "repo-removed");
    mkdirSync(join(checkout, ".worktrees", "bad-fixture"), { recursive: true });
    writeBiomeJson(checkout, "removed");
    writeFileSync(join(checkout, "sample.js"), cleanJs);
    writeFileSync(join(checkout, ".worktrees", "bad-fixture", "bad.js"), uglyJs);

    const result = runBiome(checkout);
    if (result.code === 0) {
      throw new Error(
        `removed worktree exclusion unexpectedly passed; bad.js should have caused a failure.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    assertAtLeast(result.stdout, 3, "root removed config");
    // Confirm the failure is caused by the bad fixture, not by an unrelated config error.
    if (!result.stderr.includes("badlyFormatted") && !result.stdout.includes("bad.js")) {
      throw new Error(
        `root removed config failed for an unexpected reason; expected bad.js diagnostics.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    return true;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * @returns {string} summary message
 */
export function checkWorktreeLint() {
  assertRootCheckoutCurrentConfig();
  assertNestedCheckoutCurrentConfig();
  assertNestedCheckoutRevertedConfigFails();
  assertRootCheckoutRemovedConfigFails();
  return "check-worktree-lint: ok";
}

if (import.meta.main) {
  try {
    const message = checkWorktreeLint();
    process.stdout.write(`${message}\n`);
  } catch (e) {
    process.stderr.write(`check-worktree-lint: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
