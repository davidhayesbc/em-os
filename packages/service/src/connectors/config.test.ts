import { ApiError } from "@emos/api-contract";
import { ConnectorError } from "@emos/connectors";
import { openDb } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { spyLogger } from "../test-helpers.js";
import {
  clearConnectorSecrets,
  isSecretField,
  readConnectorConfigs,
  restoreSecrets,
  sanitizeLegacyConnectorConfigs,
  stripSecrets,
  writeConnectorConfig,
} from "./config.js";

interface RecordingSecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  values: Map<string, string>;
  log: Array<{ op: "get" | "set" | "delete"; key: string; value?: string }>;
}

function createRecordingSecretStore(): RecordingSecretStore {
  const values = new Map<string, string>();
  const log: RecordingSecretStore["log"] = [];
  return {
    values,
    log,
    get: async (key) => {
      log.push({ op: "get", key });
      return values.get(key) ?? null;
    },
    set: async (key, value) => {
      log.push({ op: "set", key, value });
      values.set(key, value);
    },
    delete: async (key) => {
      log.push({ op: "delete", key });
      values.delete(key);
    },
  };
}

describe("isSecretField", () => {
  it("matches common secret tokens case-insensitively", () => {
    expect(isSecretField("secretKey")).toBe(true);
    expect(isSecretField("apiKey")).toBe(true);
    expect(isSecretField("api_key")).toBe(true);
    expect(isSecretField("api-key")).toBe(true);
    expect(isSecretField("token")).toBe(true);
    expect(isSecretField("password")).toBe(true);
    expect(isSecretField("privateKey")).toBe(true);
  });

  it("does not match non-secret names", () => {
    expect(isSecretField("endpoint")).toBe(false);
    expect(isSecretField("timeout")).toBe(false);
    expect(isSecretField("region")).toBe(false);
  });
});

describe("stripSecrets", () => {
  it("moves a top-level secret string into the keychain and leaves a marker", async () => {
    const secrets = createRecordingSecretStore();
    const out = await stripSecrets(secrets, "conn", { secretKey: "TOP-SECRET" });
    expect(out).toEqual({ secretKey: { $secretRef: "secretKey" } });
    expect(secrets.values.get("connector:conn:secretKey")).toBe("TOP-SECRET");
  });

  it("recursively strips a nested secret string using an unambiguous keychain path", async () => {
    const secrets = createRecordingSecretStore();
    const out = (await stripSecrets(secrets, "nested", {
      auth: { token: "NESTED-SUPER-SECRET-42" },
      endpoint: "https://example.com",
    })) as { auth: { token: unknown }; endpoint: string };

    expect(out.auth.token).toEqual({ $secretRef: "token" });
    expect(out.endpoint).toBe("https://example.com");
    expect(secrets.values.get("connector:nested:auth.token")).toBe("NESTED-SUPER-SECRET-42");
    expect(secrets.values.has("connector:nested:endpoint")).toBe(false);
  });

  it("recursively strips an array of secret strings", async () => {
    const secrets = createRecordingSecretStore();
    const out = (await stripSecrets(secrets, "arr", {
      apiKeys: ["ARRAY-KEY-ONE", "ARRAY-KEY-TWO"],
      region: "us-east-1",
    })) as { apiKeys: unknown[]; region: string };

    expect(out.apiKeys).toEqual([{ $secretRef: "apiKeys" }, { $secretRef: "apiKeys" }]);
    expect(out.region).toBe("us-east-1");
    expect(secrets.values.get("connector:arr:apiKeys.0")).toBe("ARRAY-KEY-ONE");
    expect(secrets.values.get("connector:arr:apiKeys.1")).toBe("ARRAY-KEY-TWO");
  });

  it("recursively strips secrets inside nested arrays of objects", async () => {
    const secrets = createRecordingSecretStore();
    const out = (await stripSecrets(secrets, "deep", {
      accounts: [{ token: "ACCOUNT-A" }, { token: "ACCOUNT-B" }],
    })) as { accounts: Array<{ token: unknown }> };

    expect(out.accounts).toHaveLength(2);
    expect(out.accounts[0]?.token).toEqual({ $secretRef: "token" });
    expect(out.accounts[1]?.token).toEqual({ $secretRef: "token" });
    expect(secrets.values.get("connector:deep:accounts.0.token")).toBe("ACCOUNT-A");
    expect(secrets.values.get("connector:deep:accounts.1.token")).toBe("ACCOUNT-B");
  });

  it("strips a secret nested two or more levels below a secret-named key", async () => {
    const secrets = createRecordingSecretStore();
    const out = (await stripSecrets(secrets, "deep", {
      apiKey: { wrapper: { raw: "DEEP-SECRET-1" } },
    })) as { apiKey: { wrapper: { raw: unknown } } };

    expect(out.apiKey.wrapper.raw).toEqual({ $secretRef: "apiKey" });
    expect(secrets.values.get("connector:deep:apiKey.wrapper.raw")).toBe("DEEP-SECRET-1");
  });

  it("strips secrets inside an array of arrays", async () => {
    const secrets = createRecordingSecretStore();
    const out = (await stripSecrets(secrets, "deep", {
      apiKeys: [["NESTED-KEY-1"]],
    })) as { apiKeys: unknown[] };

    expect(out.apiKeys).toEqual([[{ $secretRef: "apiKeys" }]]);
    expect(secrets.values.get("connector:deep:apiKeys.0.0")).toBe("NESTED-KEY-1");
  });
});

describe("restoreSecrets", () => {
  it("restores a top-level secret from the keychain", async () => {
    const secrets = createRecordingSecretStore();
    await secrets.set("connector:conn:secretKey", "TOP-SECRET");
    const out = (await restoreSecrets(secrets, "conn", {
      secretKey: { $secretRef: "secretKey" },
    })) as { secretKey: string };
    expect(out.secretKey).toBe("TOP-SECRET");
  });

  it("restores nested and array secrets using their full paths", async () => {
    const secrets = createRecordingSecretStore();
    await secrets.set("connector:nested:auth.token", "NESTED-SUPER-SECRET-42");
    await secrets.set("connector:nested:apiKeys.0", "ARRAY-KEY-ONE");
    await secrets.set("connector:nested:apiKeys.1", "ARRAY-KEY-TWO");
    await secrets.set("connector:nested:accounts.0.token", "ACCOUNT-A");

    const out = (await restoreSecrets(secrets, "nested", {
      auth: { token: { $secretRef: "token" } },
      apiKeys: [{ $secretRef: "apiKeys" }, { $secretRef: "apiKeys" }],
      accounts: [{ token: { $secretRef: "token" } }],
    })) as {
      auth: { token: string };
      apiKeys: string[];
      accounts: Array<{ token: string }>;
    };

    expect(out.auth.token).toBe("NESTED-SUPER-SECRET-42");
    expect(out.apiKeys).toEqual(["ARRAY-KEY-ONE", "ARRAY-KEY-TWO"]);
    expect(out.accounts).toHaveLength(1);
    expect(out.accounts[0]?.token).toBe("ACCOUNT-A");
  });

  it("leaves a forged marker in a non-secret field untouched", async () => {
    const secrets = createRecordingSecretStore();
    await secrets.set("connector:conn:token", "REAL-TOKEN");
    const out = (await restoreSecrets(secrets, "conn", {
      endpoint: { $secretRef: "token" },
    })) as { endpoint: unknown };
    expect(out.endpoint).toEqual({ $secretRef: "token" });
  });

  it("leaves a mismatched marker in a secret field untouched", async () => {
    const secrets = createRecordingSecretStore();
    const out = (await restoreSecrets(secrets, "conn", {
      token: { $secretRef: "other" },
    })) as { token: unknown };
    expect(out.token).toEqual({ $secretRef: "other" });
  });

  it("throws a config ConnectorError when a referenced secret is missing", async () => {
    const secrets = createRecordingSecretStore();
    await expect(
      restoreSecrets(secrets, "conn", { token: { $secretRef: "token" } }),
    ).rejects.toThrow(new ConnectorError("config", "Missing secret for token"));
  });

  it("restores a secret nested two or more levels below a secret-named key", async () => {
    const secrets = createRecordingSecretStore();
    await secrets.set("connector:deep:apiKey.wrapper.raw", "DEEP-SECRET-1");
    const out = (await restoreSecrets(secrets, "deep", {
      apiKey: { wrapper: { raw: { $secretRef: "apiKey" } } },
    })) as { apiKey: { wrapper: { raw: string } } };

    expect(out.apiKey.wrapper.raw).toBe("DEEP-SECRET-1");
  });

  it("restores secrets inside an array of arrays", async () => {
    const secrets = createRecordingSecretStore();
    await secrets.set("connector:deep:apiKeys.0.0", "NESTED-KEY-1");
    const out = (await restoreSecrets(secrets, "deep", {
      apiKeys: [[{ $secretRef: "apiKeys" }]],
    })) as { apiKeys: string[][] };

    expect(out.apiKeys).toEqual([["NESTED-KEY-1"]]);
  });
});

describe("writeConnectorConfig", () => {
  let db: ReturnType<typeof openDb>;
  let secrets: RecordingSecretStore;

  afterEach(() => {
    db.close();
  });

  it("rejects forbidden prototype-polluting keys and writes no keychain entries", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    const prototypeBefore = Object.prototype.toString();

    await expect(
      writeConnectorConfig(db, secrets, "c1", {
        enabled: true,
        config: JSON.parse('{"__proto__":{"token":"ORPHAN"}}') as Record<string, unknown>,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      writeConnectorConfig(db, secrets, "c1", {
        enabled: true,
        config: { constructor: { token: "ORPHAN" } },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      writeConnectorConfig(db, secrets, "c1", {
        enabled: true,
        config: { prototype: { token: "ORPHAN" } },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    expect(secrets.values.size).toBe(0);
    expect(Object.prototype.toString()).toBe(prototypeBefore);
  });

  it("rejects configs that exceed the depth cap", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();

    function nest(depth: number): unknown {
      let current: unknown = "leaf";
      for (let i = 0; i < depth; i++) {
        current = { [`k${i}`]: current };
      }
      return current;
    }

    await expect(
      writeConnectorConfig(db, secrets, "deep", { enabled: true, config: nest(64) }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      writeConnectorConfig(db, secrets, "deep", { enabled: true, config: nest(5000) }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    // Depth just below the cap is accepted (no secret path, so it is a no-op keychain-wise).
    await expect(
      writeConnectorConfig(db, secrets, "deep", { enabled: true, config: nest(63) }),
    ).resolves.toBeUndefined();
  });

  it("enforces the exact depth boundary", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();

    function buildAtDepth(depth: number): unknown {
      let current: unknown = "leaf";
      for (let i = 0; i < depth; i++) {
        current = { [`k${i}`]: current };
      }
      return current;
    }

    await expect(
      writeConnectorConfig(db, secrets, "boundary", { enabled: true, config: buildAtDepth(63) }),
    ).resolves.toBeUndefined();
    await expect(
      writeConnectorConfig(db, secrets, "boundary", { enabled: true, config: buildAtDepth(64) }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps array indices distinct from numeric-looking object keys", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();

    await writeConnectorConfig(db, secrets, "mix", {
      enabled: true,
      config: { apiKeys: ["ARRAY-SECRET"] },
    });
    expect(secrets.values.get("connector:mix:apiKeys.0")).toBe("ARRAY-SECRET");
    const configs1 = readConnectorConfigs(db);
    const restored1 = (await restoreSecrets(secrets, "mix", configs1.mix?.config)) as {
      apiKeys: string[];
    };
    expect(restored1.apiKeys).toEqual(["ARRAY-SECRET"]);

    await writeConnectorConfig(db, secrets, "mix", {
      enabled: true,
      config: { apiKeys: { "0": "OBJECT-SECRET" } },
    });
    // The old array secret is gone; the new numeric-keyed object secret is stored under a tagged path.
    expect(secrets.values.has("connector:mix:apiKeys.0")).toBe(false);
    expect(secrets.values.get("connector:mix:apiKeys.#0")).toBe("OBJECT-SECRET");
    const configs2 = readConnectorConfigs(db);
    const restored2 = (await restoreSecrets(secrets, "mix", configs2.mix?.config)) as {
      apiKeys: Record<string, string>;
    };
    expect(restored2.apiKeys).toEqual({ "0": "OBJECT-SECRET" });

    // Re-configure back to the array shape and assert the array round-trip.
    await writeConnectorConfig(db, secrets, "mix", {
      enabled: true,
      config: { apiKeys: ["ARRAY-SECRET"] },
    });
    expect(secrets.values.has("connector:mix:apiKeys.#0")).toBe(false);
    expect(secrets.values.get("connector:mix:apiKeys.0")).toBe("ARRAY-SECRET");
    const configs3 = readConnectorConfigs(db);
    const restored3 = (await restoreSecrets(secrets, "mix", configs3.mix?.config)) as {
      apiKeys: string[];
    };
    expect(restored3.apiKeys).toEqual(["ARRAY-SECRET"]);
  });

  it("does not lose a concurrent configure for a different connector id", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();

    await Promise.all([
      writeConnectorConfig(db, secrets, "a", { enabled: true, config: { token: "A-SECRET" } }),
      writeConnectorConfig(db, secrets, "b", { enabled: true, config: { token: "B-SECRET" } }),
    ]);

    const configs = readConnectorConfigs(db);
    expect(configs.a).toBeDefined();
    expect(configs.b).toBeDefined();
    expect(secrets.values.get("connector:a:token")).toBe("A-SECRET");
    expect(secrets.values.get("connector:b:token")).toBe("B-SECRET");
  });

  it("does not persist settings when deleting a stale secret fails", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await writeConnectorConfig(db, secrets, "conn", {
      enabled: true,
      config: { oldToken: "OLD", secretKey: "KEEP" },
    });

    secrets.delete = async (key) => {
      secrets.log.push({ op: "delete", key });
      throw new Error("keychain locked");
    };

    await expect(
      writeConnectorConfig(db, secrets, "conn", { enabled: true, config: { secretKey: "KEEP" } }),
    ).rejects.toMatchObject({ code: "internal" });

    const configs = readConnectorConfigs(db);
    expect(configs.conn?.config).toEqual({
      oldToken: { $secretRef: "oldToken" },
      secretKey: { $secretRef: "secretKey" },
    });
    expect(secrets.values.has("connector:conn:oldToken")).toBe(true);
  });

  it("rejects a non-object whole config", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await expect(
      writeConnectorConfig(db, secrets, "conn", { enabled: true, config: "whole-string" }),
    ).rejects.toThrow("Connector config must be an object");
  });

  it("rejects an array whole config", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await expect(
      writeConnectorConfig(db, secrets, "conn", { enabled: true, config: ["a", "b"] }),
    ).rejects.toThrow("Connector config must be an object");
  });

  it("rejects a forged marker in a non-secret field", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await expect(
      writeConnectorConfig(db, secrets, "conn", {
        enabled: true,
        config: { endpoint: { $secretRef: "token" } },
      }),
    ).rejects.toThrow("Unexpected secret marker at endpoint");
  });

  it("rejects a mismatched marker in a secret field", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await expect(
      writeConnectorConfig(db, secrets, "conn", {
        enabled: true,
        config: { token: { $secretRef: "apiKey" } },
      }),
    ).rejects.toThrow("Secret marker at token must reference token");
  });

  it("rejects a forged marker nested in a secret path", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await expect(
      writeConnectorConfig(db, secrets, "conn", {
        enabled: true,
        config: { auth: { token: { $secretRef: "endpoint" } } },
      }),
    ).rejects.toThrow("Secret marker at auth.token must reference token");
  });

  it("accepts a valid marker in a matching secret field", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await secrets.set("connector:conn:token", "PREVIOUS-TOKEN");
    await writeConnectorConfig(db, secrets, "conn", {
      enabled: true,
      config: { token: { $secretRef: "token" } },
    });
    const row = JSON.parse(
      db
        .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
        .get<{ value: string }>()?.value ?? "{}",
    );
    expect(row.conn.config.token).toEqual({ $secretRef: "token" });
  });

  it("stores nested secrets and never writes raw values to settings", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await writeConnectorConfig(db, secrets, "nested", {
      enabled: true,
      config: {
        auth: { token: "NESTED-SUPER-SECRET-42" },
        apiKeys: ["ARRAY-KEY-ONE", "ARRAY-KEY-TWO"],
      },
    });
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing row");
    expect(JSON.stringify(row)).not.toContain("NESTED-SUPER-SECRET-42");
    expect(JSON.stringify(row)).not.toContain("ARRAY-KEY-ONE");
    expect(JSON.stringify(row)).not.toContain("ARRAY-KEY-TWO");

    const configs = readConnectorConfigs(db);
    expect(configs.nested?.config).toEqual({
      auth: { token: { $secretRef: "token" } },
      apiKeys: [{ $secretRef: "apiKeys" }, { $secretRef: "apiKeys" }],
    });

    expect(secrets.values.get("connector:nested:auth.token")).toBe("NESTED-SUPER-SECRET-42");
    expect(secrets.values.get("connector:nested:apiKeys.0")).toBe("ARRAY-KEY-ONE");
    expect(secrets.values.get("connector:nested:apiKeys.1")).toBe("ARRAY-KEY-TWO");
  });

  it("stores deeply nested secrets without writing raw values to settings", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await writeConnectorConfig(db, secrets, "deep", {
      enabled: true,
      config: {
        apiKey: { wrapper: { raw: "PERSISTED-DEEP-SECRET" } },
      },
    });
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing row");
    expect(JSON.stringify(row)).not.toContain("PERSISTED-DEEP-SECRET");

    const configs = readConnectorConfigs(db);
    expect(configs.deep?.config).toEqual({
      apiKey: { wrapper: { raw: { $secretRef: "apiKey" } } },
    });

    expect(secrets.values.get("connector:deep:apiKey.wrapper.raw")).toBe("PERSISTED-DEEP-SECRET");
  });

  it("stores array-of-array secrets without writing raw values to settings", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await writeConnectorConfig(db, secrets, "deep", {
      enabled: true,
      config: {
        apiKeys: [["NESTED-KEY-1", "NESTED-KEY-2"]],
      },
    });
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing row");
    expect(JSON.stringify(row)).not.toContain("NESTED-KEY-1");
    expect(JSON.stringify(row)).not.toContain("NESTED-KEY-2");

    const configs = readConnectorConfigs(db);
    expect(configs.deep?.config).toEqual({
      apiKeys: [[{ $secretRef: "apiKeys" }, { $secretRef: "apiKeys" }]],
    });

    expect(secrets.values.get("connector:deep:apiKeys.0.0")).toBe("NESTED-KEY-1");
    expect(secrets.values.get("connector:deep:apiKeys.0.1")).toBe("NESTED-KEY-2");
  });

  it("deletes stale keychain entries when a secret field is removed or renamed", async () => {
    db = openDb(":memory:");
    secrets = createRecordingSecretStore();
    await writeConnectorConfig(db, secrets, "conn", {
      enabled: true,
      config: { oldToken: "OLD", secretKey: "KEEP" },
    });
    expect(secrets.values.has("connector:conn:oldToken")).toBe(true);
    expect(secrets.values.has("connector:conn:secretKey")).toBe(true);

    await writeConnectorConfig(db, secrets, "conn", {
      enabled: true,
      config: { secretKey: "KEEP", newToken: "NEW" },
    });

    expect(secrets.values.has("connector:conn:oldToken")).toBe(false);
    expect(secrets.values.get("connector:conn:secretKey")).toBe("KEEP");
    expect(secrets.values.get("connector:conn:newToken")).toBe("NEW");
    expect(
      secrets.log.filter((e) => e.op === "delete" && e.key === "connector:conn:oldToken"),
    ).toHaveLength(1);
  });
});

describe("clearConnectorSecrets", () => {
  it("deletes every tracked secret and removes the persisted config", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    await writeConnectorConfig(db, secrets, "conn", {
      enabled: true,
      config: {
        auth: { token: "TOK1" },
        apiKeys: ["K1", "K2"],
      },
    });

    await clearConnectorSecrets(db, secrets, "conn");

    expect(secrets.values.has("connector:conn:auth.token")).toBe(false);
    expect(secrets.values.has("connector:conn:apiKeys.0")).toBe(false);
    expect(secrets.values.has("connector:conn:apiKeys.1")).toBe(false);
    expect(readConnectorConfigs(db).conn).toBeUndefined();
    expect(secrets.log.filter((e) => e.op === "delete")).toHaveLength(3);
  });
});

describe("pathString encoding", () => {
  it("keeps keys with dots distinct from nested keys", async () => {
    const secrets = createRecordingSecretStore();
    await stripSecrets(secrets, "collide", { token: { "a.b": "ONE" } });
    await stripSecrets(secrets, "collide", { token: { a: { b: "TWO" } } });
    expect(secrets.values.get("connector:collide:token.a\\.b")).toBe("ONE");
    expect(secrets.values.get("connector:collide:token.a.b")).toBe("TWO");
  });
});

describe("stripSecrets strictness", () => {
  it("rejects non-string scalar secret values at configure time", async () => {
    const secrets = createRecordingSecretStore();
    await expect(stripSecrets(secrets, "conn", { token: 987654 })).rejects.toThrow(ApiError);
    await expect(stripSecrets(secrets, "conn", { token: 987654 })).rejects.toThrow(
      "Secret field token at token must be a string",
    );
  });

  it("rejects boolean secret values at configure time", async () => {
    const secrets = createRecordingSecretStore();
    await expect(stripSecrets(secrets, "conn", { token: true })).rejects.toThrow(ApiError);
  });

  it("rejects null secret values at configure time", async () => {
    const secrets = createRecordingSecretStore();
    await expect(stripSecrets(secrets, "conn", { token: null })).rejects.toThrow(ApiError);
    await expect(stripSecrets(secrets, "conn", { token: null })).rejects.toThrow(
      "Secret field token at token must be a string",
    );
  });

  it("allows existing markers and non-secret scalars", async () => {
    const secrets = createRecordingSecretStore();
    const out = await stripSecrets(secrets, "conn", { token: { $secretRef: "token" }, count: 7 });
    expect(out).toEqual({ token: { $secretRef: "token" }, count: 7 });
  });
});

describe("sanitizeLegacyConnectorConfigs", () => {
  it("moves nested plaintext legacy secrets into the keychain and rewrites the settings row", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "connector_configs",
      JSON.stringify({
        legacy: { enabled: true, config: { auth: { token: "LEGACY-PLAINTEXT-TOKEN" } } },
      }),
    );

    await sanitizeLegacyConnectorConfigs(db, secrets);

    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing row");
    expect(JSON.stringify(row)).not.toContain("LEGACY-PLAINTEXT-TOKEN");
    const configs = JSON.parse(row.value) as Record<string, { enabled: boolean; config: unknown }>;
    expect(configs.legacy?.config).toEqual({ auth: { token: { $secretRef: "token" } } });
    expect(secrets.values.get("connector:legacy:auth.token")).toBe("LEGACY-PLAINTEXT-TOKEN");
  });

  it("runs only once per database", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "connector_configs",
      JSON.stringify({
        legacy: { enabled: true, config: { secretKey: "FIRST" } },
      }),
    );

    await sanitizeLegacyConnectorConfigs(db, secrets);
    secrets.log.length = 0;
    secrets.values.clear();
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(
      JSON.stringify({
        legacy: { enabled: true, config: { secretKey: "SECOND" } },
      }),
      "connector_configs",
    );

    await sanitizeLegacyConnectorConfigs(db, secrets);

    expect(secrets.log).toHaveLength(0);
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(JSON.parse(row?.value ?? "{}").legacy.config.secretKey).toBe("SECOND");
  });

  it("logs only the failing connector ids when sanitization is incomplete", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    let shouldThrow = false;
    secrets.set = async (key, value) => {
      secrets.log.push({ op: "set", key, value });
      if (shouldThrow && key.includes("connector:fail:")) throw new Error("keychain locked");
      secrets.values.set(key, value);
    };

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "connector_configs",
      JSON.stringify({
        ok: { enabled: true, config: { secretKey: "OK" } },
        fail: { enabled: true, config: { secretKey: "FAIL" } },
      }),
    );

    shouldThrow = true;
    const spy = spyLogger();
    await sanitizeLegacyConnectorConfigs(db, secrets, spy);

    const incomplete = spy.calls.find((c) => c.event === "connector_configs_sanitizer.incomplete");
    expect(incomplete).toBeDefined();
    expect((incomplete?.fields as { retryCount?: number })?.retryCount).toBe(1);
    expect((incomplete?.fields as { failedIds?: string })?.failedIds).toBe("fail");
  });

  it("retries a connector whose secret store set failed and scrubs plaintext once the store recovers", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    let shouldThrow = true;
    secrets.set = async (key, value) => {
      secrets.log.push({ op: "set", key, value });
      if (shouldThrow) throw new Error("keychain locked");
      secrets.values.set(key, value);
    };

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "connector_configs",
      JSON.stringify({
        legacy: { enabled: true, config: { secretKey: "LEGACY-PLAINTEXT" } },
      }),
    );

    const spy = spyLogger();
    await sanitizeLegacyConnectorConfigs(db, secrets, spy);

    // The one-shot flag is left unset so the next start retries.
    const flagRow1 = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get<{ value: string }>("connector_configs_sanitized_v1");
    expect(flagRow1?.value).not.toBe("1");

    // The failing connector's plaintext is left in place until retry succeeds.
    const row1 = db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(JSON.parse(row1?.value ?? "{}").legacy.config.secretKey).toBe("LEGACY-PLAINTEXT");

    // The sanitizer attempted the failing connector once and logged the failure.
    expect(secrets.log.filter((e) => e.op === "set")).toHaveLength(1);
    expect(
      spy.calls.some(
        (c) => c.level === "warn" && c.event === "connector_configs_sanitizer.connector_failed",
      ),
    ).toBe(true);

    // Simulate the keychain becoming available again.
    shouldThrow = false;
    secrets.log.length = 0;
    await sanitizeLegacyConnectorConfigs(db, secrets, spy);

    const flagRow2 = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get<{ value: string }>("connector_configs_sanitized_v1");
    expect(flagRow2?.value).toBe("1");

    const row2 = db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(JSON.stringify(row2)).not.toContain("LEGACY-PLAINTEXT");
    expect(JSON.parse(row2?.value ?? "{}").legacy.config.secretKey).toEqual({
      $secretRef: "secretKey",
    });
    expect(secrets.values.get("connector:legacy:secretKey")).toBe("LEGACY-PLAINTEXT");
  });
});

describe("partial stale secret deletion failure", () => {
  it("aborts before persisting and attempts every stale delete even if the first fails", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    await writeConnectorConfig(db, secrets, "conn", {
      enabled: true,
      config: { oldToken: "OLD", otherToken: "OTHER", secretKey: "KEEP" },
    });
    secrets.log.length = 0;

    let deleteCount = 0;
    secrets.delete = async (key) => {
      secrets.log.push({ op: "delete", key });
      deleteCount++;
      if (deleteCount === 1) throw new Error("keychain locked");
      secrets.values.delete(key);
    };

    await expect(
      writeConnectorConfig(db, secrets, "conn", { enabled: true, config: { secretKey: "KEEP" } }),
    ).rejects.toMatchObject({ code: "internal" });

    const configs = readConnectorConfigs(db);
    expect(configs.conn?.config).toEqual({
      oldToken: { $secretRef: "oldToken" },
      otherToken: { $secretRef: "otherToken" },
      secretKey: { $secretRef: "secretKey" },
    });
    // oldToken's delete failed, so it is still present; otherToken's delete succeeded.
    expect(secrets.values.has("connector:conn:oldToken")).toBe(true);
    expect(secrets.values.has("connector:conn:otherToken")).toBe(false);
    // The new settings were not persisted because at least one delete failed.
    expect(secrets.log.filter((e) => e.op === "delete")).toHaveLength(2);
  });
});

describe("legacy forbidden key recovery", () => {
  it("allows configure and remove on a row with constructor/prototype keys", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "connector_configs",
      JSON.stringify({
        bad: {
          enabled: true,
          config: { constructor: { token: { $secretRef: "token" } } },
        },
      }),
    );
    await secrets.set("connector:bad:constructor.token", "FORBIDDEN-SECRET");

    // Read-path validation used to reject these stored keys, leaving the connector wedged.
    await expect(
      writeConnectorConfig(db, secrets, "bad", { enabled: true, config: { token: "NEW" } }),
    ).resolves.toBeUndefined();

    const configs = readConnectorConfigs(db);
    expect(configs.bad?.config).toEqual({ token: { $secretRef: "token" } });

    await expect(clearConnectorSecrets(db, secrets, "bad")).resolves.toBeUndefined();
    expect(readConnectorConfigs(db).bad).toBeUndefined();
  });
});

describe("collectSecretRefs depth", () => {
  it("throws when a legacy config exceeds the depth cap instead of silently truncating", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();

    function nest(depth: number, leaf: unknown): unknown {
      let current = leaf;
      for (let i = 0; i < depth; i++) {
        current = { [`k${i}`]: current };
      }
      return current;
    }

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "connector_configs",
      JSON.stringify({
        deep: { enabled: true, config: nest(65, { $secretRef: "token" }) },
      }),
    );

    await expect(clearConnectorSecrets(db, secrets, "deep")).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});

describe("writeConnectorConfig concurrency", () => {
  it("serializes concurrent writes for the same connector id", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    let active = 0;
    let maxActive = 0;

    secrets.set = async (key, value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      secrets.values.set(key, value);
      secrets.log.push({ op: "set", key, value });
      active--;
    };

    await Promise.all([
      writeConnectorConfig(db, secrets, "conn", { enabled: true, config: { token: "A" } }),
      writeConnectorConfig(db, secrets, "conn", { enabled: true, config: { token: "B" } }),
    ]);

    // The AsyncMutex serializes writes, so keychain sets never overlap.
    expect(maxActive).toBe(1);
    const configs = readConnectorConfigs(db);
    expect(configs.conn).toBeDefined();
  });
});

describe("pathString numeric-key encoding", () => {
  it("intentionally orphans pre-existing secrets stored under bare numeric or #-prefixed object keys", async () => {
    const db = openDb(":memory:");
    const secrets = createRecordingSecretStore();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "connector_configs",
      JSON.stringify({
        numeric: {
          enabled: true,
          config: {
            tokens: { "0": { $secretRef: "tokens" }, "#hash": { $secretRef: "tokens" } },
          },
        },
      }),
    );
    await secrets.set("connector:numeric:tokens.0", "LEGACY-NUMERIC-SECRET");
    await secrets.set("connector:numeric:tokens.#hash", "LEGACY-HASH-SECRET");

    const configs = readConnectorConfigs(db);
    // The new encoding looks for tokens.#0 / tokens.##hash, so the bare legacy secrets are
    // invisible to restore and would throw a missing-secret error.
    await expect(restoreSecrets(secrets, "numeric", configs.numeric?.config)).rejects.toThrow(
      "Missing secret for tokens.#0",
    );
    expect(secrets.values.get("connector:numeric:tokens.0")).toBe("LEGACY-NUMERIC-SECRET");
    expect(secrets.values.get("connector:numeric:tokens.#hash")).toBe("LEGACY-HASH-SECRET");

    // Reconfiguring stores new secrets under the tagged paths and leaves legacy paths orphaned.
    await writeConnectorConfig(db, secrets, "numeric", {
      enabled: true,
      config: { tokens: { "0": "NEW-NUMERIC-SECRET", "#hash": "NEW-HASH-SECRET" } },
    });
    expect(secrets.values.has("connector:numeric:tokens.0")).toBe(true);
    expect(secrets.values.has("connector:numeric:tokens.#hash")).toBe(true);
    expect(secrets.values.get("connector:numeric:tokens.#0")).toBe("NEW-NUMERIC-SECRET");
    expect(secrets.values.get("connector:numeric:tokens.##hash")).toBe("NEW-HASH-SECRET");

    // Removing the connector deletes only the tagged secrets; legacy bare paths stay orphaned.
    await clearConnectorSecrets(db, secrets, "numeric");
    expect(readConnectorConfigs(db).numeric).toBeUndefined();
    expect(secrets.values.has("connector:numeric:tokens.0")).toBe(true);
    expect(secrets.values.has("connector:numeric:tokens.#hash")).toBe(true);
  });
});
