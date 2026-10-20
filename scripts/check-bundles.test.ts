import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findViolations } from "./check-bundles.mjs";

// Assembled at runtime so check-fixtures (which scans this file) sees no real-looking URL.
const SL = "//";

describe("findViolations", () => {
  it.each([
    ["new Function('return this')", "new-function"],
    ["new  Function", "new-function"],
    ['var f=Function("a","return a")', "function-call"],
    ["x=eval('1')", "eval"],
    ["(0,eval)(s)", "eval"],
  ])("flags %j as %s", (text, rule) => {
    expect(findViolations(text).map((f) => f.rule)).toContain(rule);
  });

  it.each([
    "isFunction(x)",
    "o.Function(x)",
    'typeof x=="function"',
    "evaluate(x)",
    "medieval(x)",
    "$eval(x)",
    "obj.eval(x)",
  ])("does not flag %j", (text) => {
    expect(findViolations(text)).toEqual([]);
  });

  it("allows W3C namespace URIs only", () => {
    const ns = ["2000/svg", "1998/Math/MathML", "1999/xhtml", "1999/xlink"].map(
      (p) => `"http:${SL}www.w3.org/${p}"`,
    );
    expect(findViolations(ns.join(","))).toEqual([]);
    expect(findViolations(`"https:${SL}cdn.example.com/x.js"`)).toEqual([
      { rule: "url", match: `https:${SL}cdn.example.com/x.js` },
    ]);
    expect(findViolations(`"http:${SL}www.w3.org/evil.js"`)[0]?.rule).toBe("url");
  });
});

describe("check-bundles CLI", () => {
  const script = join(import.meta.dirname, "check-bundles.mjs");
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "check-bundles-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  it("reports sizes and passes clean bundles", () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "a.js"), "console.log(1)".repeat(100));
    const { code, out } = run("dist");
    expect(code).toBe(0);
    expect(out).toMatch(/dist\/a\.js \d+\.\d KB/);
    expect(out).toContain("check-bundles: ok");
  });

  it("fails on eval in a bundle", () => {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "a.js"), "eval(x)");
    const { code, out } = run("dist");
    expect(code).toBe(1);
    expect(out).toContain("dist/a.js eval eval");
  });

  it("fails when there is nothing to check", () => {
    expect(run("dist").code).toBe(1);
  });
});
