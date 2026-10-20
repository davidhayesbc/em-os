// Declarations are emitted from each package's build-only tsconfig, which must leave out tests
// and test helpers; type-checking (`tsconfig.json`) must still cover them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

/** Packages built by scripts/build.mjs (the ones that emit `.d.ts`). */
const packages = readdirSync(join(root, "packages")).filter((dir) => {
  const file = join(root, "packages", dir, "package.json");
  if (!existsSync(file)) return false;
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { scripts?: { build?: string } };
  return pkg.scripts?.build?.includes("scripts/build.mjs") ?? false;
});

function fileNames(dir: string, config: string): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(dir, config),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    },
  );
  if (!parsed) throw new Error(`cannot parse ${config} in ${dir}`);
  return parsed.fileNames.map((f) => f.slice(dir.length + 1).replaceAll("\\", "/"));
}

const isTestFile = (f: string) => /\.test\.tsx?$/.test(f) || /(^|\/)test-helpers\.ts$/.test(f);

describe("build-only tsconfig", () => {
  it("covers every package built by scripts/build.mjs", () => {
    expect(packages.sort()).toEqual(["api-contract", "cli", "core", "service", "store-sqlite"]);
  });

  it.each(packages)("%s: tsconfig.build.json leaves out tests and test helpers", (name) => {
    const dir = join(root, "packages", name);
    const build = fileNames(dir, "tsconfig.build.json");
    expect(build).toContain("src/index.ts");
    expect(build.filter(isTestFile)).toEqual([]);
  });

  it.each(packages)("%s: tsconfig.json (typecheck) still includes the tests", (name) => {
    const dir = join(root, "packages", name);
    const all = fileNames(dir, "tsconfig.json");
    expect(all.some((f) => /\.test\.tsx?$/.test(f))).toBe(true);
  });
});
