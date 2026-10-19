import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const probe = "packages/core/src/__probe.ts";

function lintProbe(source: string) {
  const file = join(root, probe);
  writeFileSync(file, source);
  try {
    const result = spawnSync("npx", ["biome", "lint", probe], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    return {
      exitCode: result.status,
      output: `${result.stdout}${result.stderr}`,
    };
  } finally {
    rmSync(file, { force: true });
  }
}

describe("@emos/core import boundary", () => {
  it("rejects node:fs imports", () => {
    const result = lintProbe('import fs from "node:fs";\nexport const x = fs;\n');
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/noRestrictedImports/);
  });

  it.each([
    "node:fs",
    "fs",
    "node:net",
    "net",
    "node:http",
    "http",
    "node:child_process",
    "child_process",
    "vscode",
    "better-sqlite3",
    "node:sqlite",
    "sql.js",
    "wa-sqlite",
    "@modelcontextprotocol/sdk",
    "@anthropic-ai/sdk",
    "@anthropic-ai/claude-agent-sdk",
    "openai",
    "ollama",
  ])("rejects %s", (mod) => {
    const result = lintProbe(`import * as m from "${mod}";\nexport const x = m;\n`);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/noRestrictedImports/);
  });

  it("allows ordinary imports", () => {
    const result = lintProbe('import { join } from "node:path";\nexport const x = join;\n');
    expect(result.exitCode).toBe(0);
  });
});
