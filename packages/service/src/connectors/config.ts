import type { SecretStore } from "@emos/core";
import type { Db } from "@emos/store-sqlite";

const KEY = "connector_configs";

/** Field names that signal a secret value (case-insensitive). */
const SECRET_FIELD_RE = /secret|token|password|api[_-]?key|private/i;

export interface StoredConnectorConfig {
  enabled: boolean;
  config: unknown;
}

export function isSecretField(key: string): boolean {
  return SECRET_FIELD_RE.test(key);
}

function secretStoreKey(connectorId: string, field: string): string {
  return `connector:${connectorId}:${field}`;
}

/**
 * Move secret string values from `config` into `secrets` and replace them with a reference
 * marker so the persisted settings JSON never contains the raw secret.
 */
export async function stripSecrets(
  secrets: SecretStore,
  connectorId: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isSecretField(key) && typeof value === "string") {
      await secrets.set(secretStoreKey(connectorId, key), value);
      out[key] = { $secretRef: key };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Restore secret values referenced by `$secretRef` markers back into `config`.
 */
export async function restoreSecrets(
  secrets: SecretStore,
  connectorId: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (isSecretRef(value)) {
      const field = value.$secretRef;
      const stored = await secrets.get(secretStoreKey(connectorId, field));
      out[key] = stored ?? null;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isSecretRef(value: unknown): value is { $secretRef: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$secretRef" in value &&
    typeof (value as { $secretRef?: unknown }).$secretRef === "string"
  );
}

export function readConnectorConfigs(db: Db): Record<string, StoredConnectorConfig> {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get<{ value: string }>(KEY);
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    const result: Record<string, StoredConnectorConfig> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (
        typeof value === "object" &&
        value !== null &&
        "enabled" in value &&
        typeof (value as { enabled: unknown }).enabled === "boolean"
      ) {
        result[id] = {
          enabled: (value as { enabled: boolean }).enabled,
          config: (value as { config?: unknown }).config ?? {},
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function writeConnectorConfig(
  db: Db,
  secrets: SecretStore,
  id: string,
  value: StoredConnectorConfig,
): Promise<void> {
  const configs = readConnectorConfigs(db);
  const config =
    typeof value.config === "object" && value.config !== null
      ? await stripSecrets(secrets, id, value.config as Record<string, unknown>)
      : value.config;
  configs[id] = { enabled: value.enabled, config };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(KEY, JSON.stringify(configs));
}
