import { describe, expect, it } from "vitest";
import { buildOrder } from "./workspaces.mjs";

const pkg = (
  name: string,
  deps: Record<string, string> = {},
  dev: Record<string, string> = {},
) => ({
  name,
  dependencies: deps,
  devDependencies: dev,
});

describe("buildOrder", () => {
  it("builds dependencies before dependents, even when they sort later alphabetically", () => {
    const order = buildOrder([
      pkg("@emos/service", { "@emos/store-sqlite": "0.0.0", "@emos/core": "0.0.0" }),
      pkg("@emos/store-sqlite", { "@emos/core": "0.0.0" }),
      pkg("@emos/core"),
      pkg("@emos/api-contract", { zod: "^4" }),
    ]);
    expect(order).toEqual([
      "@emos/api-contract",
      "@emos/core",
      "@emos/store-sqlite",
      "@emos/service",
    ]);
  });

  it("counts devDependencies on workspace packages and ignores external ones", () => {
    expect(
      buildOrder([pkg("@emos/a", {}, { "@emos/b": "0.0.0", vitest: "^5" }), pkg("@emos/b")]),
    ).toEqual(["@emos/b", "@emos/a"]);
  });

  it("is deterministic: independent packages come out alphabetically", () => {
    expect(buildOrder([pkg("@emos/c"), pkg("@emos/a"), pkg("@emos/b")])).toEqual([
      "@emos/a",
      "@emos/b",
      "@emos/c",
    ]);
  });

  it("rejects a dependency cycle", () => {
    expect(() =>
      buildOrder([pkg("@emos/a", { "@emos/b": "0" }), pkg("@emos/b", { "@emos/a": "0" })]),
    ).toThrow(/cycle/i);
  });
});
