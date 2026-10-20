import { describe, expect, it } from "vitest";
import { secretStoreKind } from "./secrets.js";

describe("secretStoreKind (test-only EMOS_SECRET_STORE switch)", () => {
  it("defaults to the OS keychain", () => {
    expect(secretStoreKind({})).toEqual({ kind: "keychain", ignored: false });
    expect(secretStoreKind({ EMOS_DATA_DIR: "/tmp/emos" })).toEqual({
      kind: "keychain",
      ignored: false,
    });
  });

  it("selects the memory store when EMOS_DATA_DIR is also set", () => {
    expect(secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: "/tmp/emos" })).toEqual({
      kind: "memory",
      ignored: false,
    });
  });

  it("ignores the switch without EMOS_DATA_DIR, so the real data dir always uses the keychain", () => {
    expect(secretStoreKind({ EMOS_SECRET_STORE: "memory" })).toEqual({
      kind: "keychain",
      ignored: true,
    });
    expect(secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: "" })).toEqual({
      kind: "keychain",
      ignored: true,
    });
  });

  it("ignores unknown values", () => {
    expect(secretStoreKind({ EMOS_SECRET_STORE: "plaintext", EMOS_DATA_DIR: "/tmp/e" })).toEqual({
      kind: "keychain",
      ignored: true,
    });
  });
});
