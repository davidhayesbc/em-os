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
    "node:fs/promises",
    "fs/promises",
    "node:net",
    "net",
    "node:http",
    "http",
    "node:https",
    "https",
    "node:http2",
    "http2",
    "node:tls",
    "tls",
    "node:dgram",
    "dgram",
    "node:worker_threads",
    "worker_threads",
    "node:child_process",
    "child_process",
    "vscode",
    "better-sqlite3",
    "better-sqlite3/lib/database.js",
    "node:sqlite",
    "sql.js",
    "sql.js/dist/sql-wasm.js",
    "wa-sqlite",
    "wa-sqlite/src/sqlite-api.js",
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/server/index.js",
    "@anthropic-ai/sdk",
    "@anthropic-ai/sdk/resources/messages",
    "@anthropic-ai/claude-agent-sdk",
    "@anthropic-ai/claude-agent-sdk/sdk",
    "openai",
    "openai/resources/chat",
    "ollama",
    "ollama/browser",
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
