// SecretStore implementations (KEYCHAIN_LIB = @napi-rs/keyring, ADR 0001 "Spike result").
// Secret values are never logged, persisted elsewhere or put into error messages here.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { SecretStore } from "@emos/core";
import { resolveDataDir } from "@emos/store-sqlite";
import { AsyncEntry } from "@napi-rs/keyring";

/**
 * The OS keychain (macOS Keychain, Windows Credential Manager): one generic credential per key,
 * under `service` with the key as the account name. Windows limits credential blobs to a few KB,
 * so store only small secrets (tokens), not documents.
 */
export function createKeychainSecretStore(service = "em-os"): SecretStore {
  const entry = (key: string) => new AsyncEntry(service, key);
  return {
    get: async (key) => (await entry(key).getPassword()) ?? null,
    set: async (key, value) => {
      await entry(key).setPassword(value);
    },
    delete: async (key) => {
      await entry(key).deletePassword(); // false = nothing to delete, which is fine
    },
  };
}

const memoryStores = new WeakSet<SecretStore>();

/** True if `store` was made by {@link createMemorySecretStore}. */
export function isMemorySecretStore(store: SecretStore): boolean {
  return memoryStores.has(store);
}

/** In-process store for tests and ephemeral runs. Values live only as long as the object. */
export function createMemorySecretStore(): SecretStore {
  const values = new Map<string, string>();
  const store: SecretStore = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
  memoryStores.add(store);
  return store;
}

export interface SecretStoreContext {
  /** The data dir this service runs on (already resolved; it is realpath'ed again here). */
  dataDir: string;
  platform?: NodeJS.Platform;
  homedir?: string;
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * TEST-ONLY switch: `EMOS_SECRET_STORE=memory` selects {@link createMemorySecretStore} so smoke
 * tests and the dev host never touch the real OS keychain. Honoured only for a throwaway data
 * dir, i.e. when all of these hold:
 * - `EMOS_DATA_DIR` is set;
 * - it is the data dir this service runs on (`realpath(dataDir) === realpath(EMOS_DATA_DIR)`);
 * - it is not the platform default data dir.
 *
 * Otherwise, and for unknown values, the keychain is used and `ignored` is true so the caller
 * can log it. Never set this for real use: the token then changes on every restart.
 */
export function secretStoreKind(
  env: NodeJS.ProcessEnv,
  ctx: SecretStoreContext,
): {
  kind: "keychain" | "memory";
  ignored: boolean;
} {
  const requested = env.EMOS_SECRET_STORE;
  if (requested === undefined || requested === "") return { kind: "keychain", ignored: false };
  const override = env.EMOS_DATA_DIR;
  if (requested !== "memory" || !override) return { kind: "keychain", ignored: true };
  const platformDefault = resolveDataDir(
    { ...env, EMOS_DATA_DIR: undefined },
    ctx.platform ?? process.platform,
    ctx.homedir ?? homedir(),
  );
  const chosen = real(override);
  if (real(ctx.dataDir) !== chosen || real(platformDefault) === chosen) {
    return { kind: "keychain", ignored: true };
  }
  return { kind: "memory", ignored: false };
}
