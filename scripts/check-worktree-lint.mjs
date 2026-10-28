// Regression test for Biome worktree exclusion.
//
// The PR #51 worktree hygiene change originally used `!**/.worktrees`, which
// excludes any path containing a `.worktrees` segment. That silently ignores
// the entire current checkout when the checkout lives under a `.worktrees`
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
// Vitest: `scripts/check-worktree-lint.test.ts` imports `checkWorktreeLint()`.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

const cleanJs = "const value = 1;\nconsole.log(value);\n";
const uglyJs = "const badlyFormatted=1\n";

function runBiome(cwd, biomeBin, args = ["check", "."]) {
  const result = spawnSync(process.execPath, [biomeBin, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function minimalConfig(worktreeExclude) {
  return JSON.stringify(
    {
      files: {
        includes: ["**", worktreeExclude],
      },
      formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 100 },
      linter: { enabled: true, rules: { preset: "recommended" } },
    },
    null,
    2,
  );
}

function writeBiomeJson(dir, worktreeExclude) {
  writeFileSync(join(dir, "biome.json"), minimalConfig(worktreeExclude));
  // Format the config so biome check does not emit formatter diagnostics for it.
  const { code, stderr } = runBiome(dir, join(repoRoot, "node_modules/.bin/biome"), [
    "format",
    "--write",
    "biome.json",
  ]);
  if (code !== 0) {
    throw new Error(`failed to format temp biome.json: ${stderr}`);
  }
}

function assertFilesProcessed(output, minFiles) {
  const match = output.match(/Checked\s+(\d+)\s+file/);
  const count = match ? Number.parseInt(match[1], 10) : 0;
  if (count < minFiles) {
    throw new Error(
      `expected at least ${minFiles} file(s) processed, got ${count}.\nOutput:\n${output}`,
    );
  }
}

/**
 * @returns {string} summary message
 */
export function checkWorktreeLint() {
  const biomeBin = join(repoRoot, "node_modules/.bin/biome");

  const base = mkdtempSync(join(tmpdir(), "worktree-lint-"));
  try {
    // Scenario 1: repo-root checkout excludes a descendant `.worktrees` dir
    // containing invalid code, while still processing files at the root.
    const rootCheckout = join(base, "repo-root");
    mkdirSync(join(rootCheckout, ".worktrees", "bad-fixture"), { recursive: true });
    writeBiomeJson(rootCheckout, "!.worktrees");
    writeFileSync(join(rootCheckout, "sample.js"), cleanJs);
    writeFileSync(join(rootCheckout, ".worktrees", "bad-fixture", "bad.js"), uglyJs);

    const rootResult = runBiome(rootCheckout, biomeBin);
    if (rootResult.code !== 0) {
      throw new Error(
        `repo-root checkout lint should pass (descendant .worktrees must be ignored), but exited ${rootResult.code}.\nstdout:\n${rootResult.stdout}\nstderr:\n${rootResult.stderr}`,
      );
    }
    assertFilesProcessed(rootResult.stdout, 1);
    if (rootResult.stdout.includes("bad.js")) {
      throw new Error("repo-root lint must not process .worktrees/bad-fixture/bad.js");
    }

    // Scenario 2: checkout whose absolute path contains `.worktrees` as an
    // ancestor must still lint its own files.
    const nestedCheckout = join(base, ".worktrees", "nested-checkout");
    mkdirSync(nestedCheckout, { recursive: true });
    writeBiomeJson(nestedCheckout, "!.worktrees");
    writeFileSync(join(nestedCheckout, "sample.js"), cleanJs);

    const nestedResult = runBiome(nestedCheckout, biomeBin);
    if (nestedResult.code !== 0) {
      throw new Error(
        `nested .worktrees checkout lint should pass, but exited ${nestedResult.code}.\nstdout:\n${nestedResult.stdout}\nstderr:\n${nestedResult.stderr}`,
      );
    }
    assertFilesProcessed(nestedResult.stdout, 1);

    // Scenario 3: control check that the old `!**/.worktrees` glob fails in the
    // nested layout, so the test catches a future accidental revert.
    const prGlobCheckout = join(base, ".worktrees", "pr-glob-checkout");
    mkdirSync(prGlobCheckout, { recursive: true });
    writeBiomeJson(prGlobCheckout, "!**/.worktrees");
    writeFileSync(join(prGlobCheckout, "sample.js"), cleanJs);

    const prGlobResult = runBiome(prGlobCheckout, biomeBin);
    if (prGlobResult.code === 0) {
      throw new Error(
        `control check failed: the old !**/.worktrees glob should fail inside a .worktrees ancestor, but it passed.\nstdout:\n${prGlobResult.stdout}\nstderr:\n${prGlobResult.stderr}`,
      );
    }
    assertFilesProcessed(prGlobResult.stdout, 0);

    return "check-worktree-lint: ok";
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
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
