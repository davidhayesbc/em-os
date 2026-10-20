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
