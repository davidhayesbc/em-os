import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { API_VERSION, defineOp, type OpInput, type OpName, type OpOutput } from "./op.js";
import { ops } from "./ops/index.js";

describe("op registry", () => {
  it("exposes health.get keyed by its own name", () => {
    expect(ops["health.get"].name).toBe("health.get");
    expect(API_VERSION).toBe(1);
  });

  it("defineOp returns its definition", () => {
    const def = { name: "x", input: z.object({}), output: z.object({ a: z.number() }) };
    expect(defineOp(def)).toBe(def);
  });

  it("health.get validates input and output", () => {
    expect(ops["health.get"].input.safeParse({}).success).toBe(true);
    const out = {
      apiVersion: 1,
      serviceVersion: "0.0.0",
      startedAt: "2026-10-20T16:00:00.000Z",
      dataDir: "/data/em-os",
      secretStore: "keychain",
      connectors: [{ id: "c1", state: "idle", lastSuccessAt: null }],
    };
    expect(ops["health.get"].output.safeParse(out).success).toBe(true);
    expect(ops["health.get"].output.safeParse({ ...out, secretStore: "memory" }).success).toBe(
      true,
    );
    expect(ops["health.get"].output.safeParse({ ...out, secretStore: "file" }).success).toBe(false);
    expect(
      ops["health.get"].output.safeParse({ ...out, startedAt: "2026-10-20T09:00:00-07:00" })
        .success,
    ).toBe(false);
  });

  it("backup.create requires an absolute dest", () => {
    const { input } = ops["backup.create"];
    for (const dest of ["/tmp/a.db", "C:\\b\\a.db", "C:/b/a.db", "\\\\host\\share\\a.db"]) {
      expect(input.safeParse({ dest }).success).toBe(true);
    }
    for (const dest of ["", "a.db", "./a.db", "../a.db"]) {
      expect(input.safeParse({ dest }).success).toBe(false);
    }
  });

  it("derives op types from the registry", () => {
    expectTypeOf<OpName>().toEqualTypeOf<"health.get" | "backup.create">();
    expectTypeOf<OpInput<"health.get">>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<OpOutput<"health.get">["apiVersion"]>().toEqualTypeOf<number>();
    expectTypeOf<OpInput<"backup.create">>().toEqualTypeOf<{ dest: string }>();
  });
});
