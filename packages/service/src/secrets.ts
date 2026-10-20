// SecretStore implementations (KEYCHAIN_LIB = @napi-rs/keyring, ADR 0001 "Spike result").
// Secret values are never logged, persisted elsewhere or put into error messages here.
import type { SecretStore } from "@emos/core";
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

/** In-process store for tests and ephemeral runs. Values live only as long as the object. */
export function createMemorySecretStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    delete: async (key) => {
      values.delete(key);
    },
  };
}

/**
 * TEST-ONLY switch: `EMOS_SECRET_STORE=memory` selects {@link createMemorySecretStore} so smoke
 * tests and the dev host never touch the real OS keychain. Honoured only when `EMOS_DATA_DIR`
 * is also set (a throwaway data dir); otherwise, and for unknown values, the keychain is used
 * and `ignored` is true so the caller can log it. Never set this for real use: the token then
 * changes on every restart.
 */
export function secretStoreKind(env: NodeJS.ProcessEnv): {
  kind: "keychain" | "memory";
  ignored: boolean;
} {
  const requested = env.EMOS_SECRET_STORE;
  if (requested === undefined || requested === "") return { kind: "keychain", ignored: false };
  if (requested === "memory" && env.EMOS_DATA_DIR) return { kind: "memory", ignored: false };
  return { kind: "keychain", ignored: true };
}
