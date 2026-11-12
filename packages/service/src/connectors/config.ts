import { ApiError } from "@emos/api-contract";
import { ConnectorError } from "@emos/connectors";
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

function secretStoreKey(connectorId: string, path: string): string {
  return `connector:${connectorId}:${path}`;
}

type JsonPath = Array<string | number>;

function pathString(path: JsonPath): string {
  return path.join(".");
}

function isSecretMarker(value: unknown): value is { $secretRef: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    "$secretRef" in value &&
    typeof (value as { $secretRef?: unknown }).$secretRef === "string"
  );
}

/**
 * Returns the secret field name for a given JSON path. For object properties this is the last
 * segment; for array elements it is the parent key (so `apiKeys[0]` belongs to the `apiKeys` field).
 */
function secretFieldForPath(path: JsonPath): string | undefined {
  const last = path[path.length - 1];
  if (typeof last === "string" && isSecretField(last)) return last;
  const parent = path[path.length - 2];
  if (typeof parent === "string" && isSecretField(parent)) return parent;
  return undefined;
}

function isSecretPath(path: JsonPath): boolean {
  return secretFieldForPath(path) !== undefined;
}

/**
 * Recursively collect every `$secretRef` path in a stored config. These are the keychain paths
 * the service has tracked for this connector.
 */
function collectSecretRefs(value: unknown, path: JsonPath = []): string[] {
  const refs: string[] = [];
  if (isSecretMarker(value)) {
    refs.push(pathString(path));
    return refs;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      refs.push(...collectSecretRefs(value[i], [...path, i]));
    }
    return refs;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, val] of Object.entries(value)) {
      refs.push(...collectSecretRefs(val, [...path, key]));
    }
    return refs;
  }
  return refs;
}

/**
 * Validate that the caller-supplied config does not contain forged `$secretRef` markers.
 * Markers are only valid in secret-named fields, and the reference must name that field.
 */
function assertNoForgedMarkers(value: unknown, path: JsonPath = []): void {
  if (isSecretMarker(value)) {
    const field = secretFieldForPath(path);
    if (field === undefined) {
      throw new ApiError("invalid_input", `Unexpected secret marker at ${pathString(path)}`);
    }
    if (value.$secretRef !== field) {
      throw new ApiError(
        "invalid_input",
        `Secret marker at ${pathString(path)} must reference ${field}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertNoForgedMarkers(value[i], [...path, i]);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, val] of Object.entries(value)) {
      assertNoForgedMarkers(val, [...path, key]);
    }
    return;
  }
}

/**
 * Recursively move secret string values from `config` into `secrets` and replace them with a
 * reference marker so the persisted settings JSON never contains the raw secret.
 */
async function stripSecretsRecursive(
  secrets: SecretStore,
  connectorId: string,
  value: unknown,
  path: JsonPath,
): Promise<unknown> {
  // A pre-existing marker is a sentinel, not a container; do not recurse into it.
  if (isSecretMarker(value)) return value;

  if (typeof value === "string" && isSecretPath(path)) {
    const field = secretFieldForPath(path) as string;
    const storePath = pathString(path);
    await secrets.set(secretStoreKey(connectorId, storePath), value);
    return { $secretRef: field };
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      out.push(await stripSecretsRecursive(secrets, connectorId, value[i], [...path, i]));
    }
    return out;
  }

  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = await stripSecretsRecursive(secrets, connectorId, val, [...path, key]);
    }
    return out;
  }

  return value;
}

/**
 * Move secret string values from `config` into `secrets` and replace them with a reference marker.
 * Returns the sanitized config.
 */
export async function stripSecrets(
  secrets: SecretStore,
  connectorId: string,
  config: unknown,
): Promise<unknown> {
  return stripSecretsRecursive(secrets, connectorId, config, []);
}

/**
 * Recursively restore secret values referenced by `$secretRef` markers back into `config`.
 * Markers are only honoured in secret-named fields and must reference that exact field.
 * A missing keychain entry throws a `ConnectorError` of kind `"config"`.
 */
async function restoreSecretsRecursive(
  secrets: SecretStore,
  connectorId: string,
  value: unknown,
  path: JsonPath,
): Promise<unknown> {
  if (isSecretMarker(value)) {
    const field = secretFieldForPath(path);
    if (field === undefined || value.$secretRef !== field) {
      // Forged or misplaced marker: leave it untouched. `configure` already rejects these.
      return value;
    }
    const storePath = pathString(path);
    const stored = await secrets.get(secretStoreKey(connectorId, storePath));
    if (stored === null) {
      throw new ConnectorError("config", `Missing secret for ${storePath}`);
    }
    return stored;
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      out.push(await restoreSecretsRecursive(secrets, connectorId, value[i], [...path, i]));
    }
    return out;
  }

  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = await restoreSecretsRecursive(secrets, connectorId, val, [...path, key]);
    }
    return out;
  }

  return value;
}

/**
 * Restore secret values referenced by `$secretRef` markers back into `config`.
 */
export async function restoreSecrets(
  secrets: SecretStore,
  connectorId: string,
  config: unknown,
): Promise<unknown> {
  return restoreSecretsRecursive(secrets, connectorId, config, []);
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
  if (typeof value.config !== "object" || value.config === null || Array.isArray(value.config)) {
    throw new ApiError("invalid_input", `Connector config must be an object`);
  }

  assertNoForgedMarkers(value.config);

  const configs = readConnectorConfigs(db);
  const previous = configs[id]?.config;
  const previousRefs = previous === undefined ? [] : collectSecretRefs(previous);

  const config = await stripSecrets(secrets, id, value.config);
  const currentRefs = collectSecretRefs(config);

  configs[id] = { enabled: value.enabled, config };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(KEY, JSON.stringify(configs));

  // F4: delete keychain entries for secret paths that were present before but are absent now.
  for (const ref of previousRefs) {
    if (!currentRefs.includes(ref)) {
      await secrets.delete(secretStoreKey(id, ref));
    }
  }
}

/**
 * Remove a connector's persisted config and delete every keychain entry tracked by its markers.
 */
export async function clearConnectorSecrets(
  db: Db,
  secrets: SecretStore,
  connectorId: string,
): Promise<void> {
  const configs = readConnectorConfigs(db);
  const config = configs[connectorId]?.config;
  if (config === undefined) return;

  const refs = collectSecretRefs(config);
  for (const ref of refs) {
    await secrets.delete(secretStoreKey(connectorId, ref));
  }

  delete configs[connectorId];
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(KEY, JSON.stringify(configs));
}
