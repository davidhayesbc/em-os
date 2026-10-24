import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDir } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createKeychainSecretStore,
  createMemorySecretStore,
  isMemorySecretStore,
  secretStoreKind,
} from "./secrets.js";
import { cleanup, tmpDir } from "./test-helpers.js";

afterEach(cleanup);

/** A data dir under a temp "home", so the platform default is a different directory. */
function setup() {
  const home = tmpDir();
  const dataDir = join(home, "throwaway");
  mkdirSync(dataDir);
  const ctx = { dataDir, platform: process.platform, homedir: home };
  return { home, dataDir, ctx };
}

describe("secretStoreKind (test-only EMOS_SECRET_STORE switch)", () => {
  it("defaults to the OS keychain", () => {
    const { dataDir, ctx } = setup();
    expect(secretStoreKind({}, ctx)).toEqual({ kind: "keychain", ignored: false });
    expect(secretStoreKind({ EMOS_DATA_DIR: dataDir }, ctx)).toEqual({
      kind: "keychain",
      ignored: false,
    });
  });

  it("selects the memory store when EMOS_DATA_DIR names this service's data dir", () => {
    const { dataDir, ctx } = setup();
    expect(secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: dataDir }, ctx)).toEqual({
      kind: "memory",
      ignored: false,
    });
  });

  it.skipIf(process.platform === "win32")(
    "compares real paths (EMOS_DATA_DIR may reach the data dir through a symlink)",
    () => {
      const { home, dataDir, ctx } = setup();
      const link = join(home, "link");
      symlinkSync(dataDir, link);
      expect(secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: link }, ctx).kind).toBe(
        "memory",
      );
    },
  );

  it("ignores the switch without EMOS_DATA_DIR, so the real data dir always uses the keychain", () => {
    const { ctx } = setup();
    expect(secretStoreKind({ EMOS_SECRET_STORE: "memory" }, ctx)).toEqual({
      kind: "keychain",
      ignored: true,
    });
    expect(secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: "" }, ctx)).toEqual({
      kind: "keychain",
      ignored: true,
    });
  });

  it("ignores it when the service runs on a different data dir than EMOS_DATA_DIR", () => {
    const { home, ctx } = setup();
    const other = join(home, "other");
    mkdirSync(other);
    expect(secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: other }, ctx)).toEqual({
      kind: "keychain",
      ignored: true,
    });
  });

  it("ignores it when EMOS_DATA_DIR is the platform default data dir", () => {
    const home = tmpDir();
    const platformDefault = resolveDataDir({}, process.platform, home);
    mkdirSync(platformDefault, { recursive: true });
    const ctx = { dataDir: platformDefault, platform: process.platform, homedir: home };
    expect(
      secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: platformDefault }, ctx),
    ).toEqual({ kind: "keychain", ignored: true });
  });

  it.each(["darwin", "win32"] as const)(
    "treats a case variant of the %s platform default as the default",
    (platform) => {
      const home = tmpDir();
      const platformDefault = resolveDataDir({}, platform, home);
      const caseVariant = platformDefault.toUpperCase();
      const ctx = { dataDir: caseVariant, platform, homedir: home };
      expect(
        secretStoreKind({ EMOS_SECRET_STORE: "memory", EMOS_DATA_DIR: caseVariant }, ctx),
      ).toEqual({ kind: "keychain", ignored: true });
    },
  );

  it("ignores unknown values", () => {
    const { dataDir, ctx } = setup();
    expect(
      secretStoreKind({ EMOS_SECRET_STORE: "plaintext", EMOS_DATA_DIR: dataDir }, ctx),
    ).toEqual({ kind: "keychain", ignored: true });
  });
});

describe("isMemorySecretStore", () => {
  it("is true only for stores made by createMemorySecretStore", () => {
    expect(isMemorySecretStore(createMemorySecretStore())).toBe(true);
    expect(isMemorySecretStore(createKeychainSecretStore("em-os-test"))).toBe(false);
    expect(
      isMemorySecretStore({ get: async () => null, set: async () => {}, delete: async () => {} }),
    ).toBe(false);
  });
});
