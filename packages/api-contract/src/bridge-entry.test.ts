// `@emos/api-contract/bridge` is what the webviews bundle, so it must stay zod-free: no runtime
// import (direct or transitive) may reach zod. Type-only imports are erased by the bundler.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as bridge from "./bridge-entry.js";
import { ApiError, ERROR_CODES, ErrorCodeSchema, isErrorCode } from "./index.js";

const src = import.meta.dirname;

/** Runtime (non-`import type`) import specifiers of a source file. */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const m of text.matchAll(/^\s*(import|export)\s+([^;]*?)\s+from\s+"([^"]+)";?/gm)) {
    const clause = m[2] ?? "";
    if (/^type\s/.test(clause)) continue; // import type / export type
    if (
      /^\{[^}]*\}$/.test(clause) &&
      clause
        .slice(1, -1)
        .split(",")
        .every((s) => /^\s*type\s/.test(s) || s.trim() === "")
    )
      continue;
    specs.push(m[3] ?? "");
  }
  for (const m of text.matchAll(/^\s*import\s+"([^"]+)";?/gm)) specs.push(m[1] ?? "");
  return specs;
}

function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of runtimeImports(file)) {
      if (spec.startsWith(".")) visit(join(dirname(file), spec.replace(/\.js$/, ".ts")));
      else seen.add(spec);
    }
  };
  visit(entry);
  return seen;
}

describe("@emos/api-contract/bridge", () => {
  it("has no runtime path to zod (or any other package)", () => {
    const reached = [...closure(join(src, "bridge-entry.ts"))].map((f) =>
      f.startsWith(src) ? f.slice(src.length + 1) : f,
    );
    expect(reached.sort()).toEqual(["bridge-entry.ts", "bridge.ts", "errors.ts"]);
  });

  it("exports ApiError, ERROR_CODES and isErrorCode", () => {
    expect(bridge.ApiError).toBe(ApiError);
    expect(bridge.ERROR_CODES).toBe(ERROR_CODES);
    expect(bridge.isErrorCode).toBe(isErrorCode);
  });
});

describe("error codes", () => {
  it("isErrorCode accepts exactly the listed codes", () => {
    for (const c of ERROR_CODES) expect(isErrorCode(c)).toBe(true);
    for (const x of ["weird", "", null, undefined, 1, {}, "toString", "__proto__"]) {
      expect(isErrorCode(x)).toBe(false);
    }
  });

  it("the zod enum is derived from the tuple", () => {
    expect(ErrorCodeSchema.options).toEqual([...ERROR_CODES]);
  });

  it("ApiError carries its code", () => {
    const e = new ApiError("conflict", "busy");
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ name: "ApiError", code: "conflict", message: "busy" });
  });
});
