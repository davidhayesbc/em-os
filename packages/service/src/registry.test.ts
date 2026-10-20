// The op registry (@emos/api-contract `ops`) and the handler registry must stay in step:
// every op is reachable, every handler is for a real op, and each key is the op's wire name.
import { ops } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { handlers } from "./handlers/index.js";

const opKeys = Object.keys(ops).sort();
const handlerKeys = Object.keys(handlers).sort();

describe("op and handler registries", () => {
  it.each(opKeys)("ops[%j].name equals its key", (key) => {
    expect(ops[key as keyof typeof ops].name).toBe(key);
  });

  it.each(opKeys)("op %j has a handler", (key) => {
    expect(typeof (handlers as Record<string, unknown>)[key]).toBe("function");
  });

  it.each(handlerKeys)("handler %j is for an op in the contract", (key) => {
    expect(Object.hasOwn(ops, key)).toBe(true);
  });

  it("both registries list the same names", () => {
    expect(handlerKeys).toEqual(opKeys);
  });
});
