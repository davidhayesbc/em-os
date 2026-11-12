import { createClient, httpTransport } from "@emos/api-contract";
import { type ConnectorDefinition, fixtureInvoker } from "@emos/connectors";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { connectorRegistry } from "../connectors/registry.js";
import { createEventBus } from "../events.js";
import { cleanup, startTestService } from "../test-helpers.js";

afterEach(cleanup);

function clientFor(svc: Awaited<ReturnType<typeof startTestService>>) {
  return createClient({
    transport: httpTransport(`http://127.0.0.1:${svc.port}`),
    token: svc.token,
  });
}

describe("connectors API", () => {
  it("lists the connector defined in the registry", async () => {
    const svc = await startTestService();
    const client = clientFor(svc);

    const list = await client.call("connectors.list", {});

    expect(list).toEqual([
      {
        id: "synthetic-fixture",
        kind: "calendar",
        enabled: false,
        state: "never",
        lastSuccessAt: null,
        lastError: null,
      },
    ]);
  });

  it("configures a connector with a secret key and never echoes the secret in connectors.list", async () => {
    const svc = await startTestService();
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "synthetic-fixture",
      enabled: true,
      config: { secretKey: "test/api-key" },
    });
    const list = await client.call("connectors.list", {});

    expect(list).toEqual([
      {
        id: "synthetic-fixture",
        kind: "calendar",
        enabled: true,
        state: "never",
        lastSuccessAt: null,
        lastError: null,
      },
    ]);

    const stored = await svc.secrets.get("connector:synthetic-fixture:secretKey");
    expect(stored).toBe("test/api-key");

    const row = svc.db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing connector_configs row");
    const configs = JSON.parse(row.value) as Record<string, { enabled: boolean; config: unknown }>;
    const fixture = configs["synthetic-fixture"];
    expect(fixture).toBeDefined();
    if (!fixture) throw new Error("missing synthetic-fixture config");
    const config = fixture.config as Record<string, unknown>;
    expect(config.secretKey).toEqual({ $secretRef: "secretKey" });
    expect(JSON.stringify(config)).not.toContain("test/api-key");
  });

  it("syncs an unconfigured connector without throwing and leaves visible sync_state", async () => {
    const svc = await startTestService();
    const client = clientFor(svc);

    const result = await client.call("connectors.sync", { id: "synthetic-fixture" });
    expect(result).toEqual({ pages: 0, items: 0 });

    const list = await client.call("connectors.list", {});
    expect(list).toEqual([
      {
        id: "synthetic-fixture",
        kind: "calendar",
        enabled: false,
        state: "ok",
        lastSuccessAt: expect.any(String),
        lastError: null,
      },
    ]);

    const row = svc.db
      .prepare("SELECT state FROM sync_state WHERE connector_id = 'synthetic-fixture'")
      .get<{ state: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing sync_state row");
    expect(row.state).toBe("ok");
  });

  it("configures a connector with a nested secret object and restores it at sync", async () => {
    let captured: unknown;
    const nestedConnector: ConnectorDefinition<unknown> = {
      id: "nested-auth",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync(ctx) {
        captured = ctx.config;
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        { def: nestedConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "nested-auth",
      enabled: true,
      config: { auth: { token: "NESTED-SUPER-SECRET-42" } },
    });

    const row = svc.db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing row");
    expect(JSON.stringify(row)).not.toContain("NESTED-SUPER-SECRET-42");
    await expect(svc.secrets.get("connector:nested-auth:auth.token")).resolves.toBe(
      "NESTED-SUPER-SECRET-42",
    );

    await client.call("connectors.sync", { id: "nested-auth" });
    expect(captured).toEqual({ auth: { token: "NESTED-SUPER-SECRET-42" } });
  });

  it("configures a connector with an array of secrets and restores them at sync", async () => {
    let captured: unknown;
    const arrayConnector: ConnectorDefinition<unknown> = {
      id: "array-keys",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync(ctx) {
        captured = ctx.config;
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        { def: arrayConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "array-keys",
      enabled: true,
      config: { apiKeys: ["ARRAY-KEY-ONE", "ARRAY-KEY-TWO"] },
    });

    const row = svc.db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing row");
    expect(JSON.stringify(row)).not.toContain("ARRAY-KEY-ONE");
    expect(JSON.stringify(row)).not.toContain("ARRAY-KEY-TWO");

    await client.call("connectors.sync", { id: "array-keys" });
    expect(captured).toEqual({ apiKeys: ["ARRAY-KEY-ONE", "ARRAY-KEY-TWO"] });
  });

  it("configures a connector with a deeply nested secret and restores it at sync", async () => {
    let captured: unknown;
    const deepConnector: ConnectorDefinition<unknown> = {
      id: "deep-auth",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync(ctx) {
        captured = ctx.config;
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        { def: deepConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "deep-auth",
      enabled: true,
      config: { apiKey: { wrapper: { raw: "PERSISTED-DEEP-SECRET" } } },
    });

    const row = svc.db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    expect(row).toBeDefined();
    if (!row) throw new Error("missing row");
    expect(JSON.stringify(row)).not.toContain("PERSISTED-DEEP-SECRET");

    await expect(svc.secrets.get("connector:deep-auth:apiKey.wrapper.raw")).resolves.toBe(
      "PERSISTED-DEEP-SECRET",
    );

    await client.call("connectors.sync", { id: "deep-auth" });
    expect(captured).toEqual({ apiKey: { wrapper: { raw: "PERSISTED-DEEP-SECRET" } } });
  });

  it("rejects a forged secret marker in a non-secret field", async () => {
    const passthroughConnector: ConnectorDefinition<unknown> = {
      id: "wide",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        { def: passthroughConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);

    await expect(
      client.call("connectors.configure", {
        id: "wide",
        enabled: true,
        config: { endpoint: { $secretRef: "token" } },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("sets sync state to error when a referenced secret is missing", async () => {
    const passthroughConnector: ConnectorDefinition<unknown> = {
      id: "missing-secret",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        { def: passthroughConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "missing-secret",
      enabled: true,
      config: { token: { $secretRef: "token" } },
    });

    const result = await client.call("connectors.sync", { id: "missing-secret" });
    expect(result).toEqual({ pages: 0, items: 0 });

    const list = (await client.call("connectors.list", {})) as Array<{
      id: string;
      state: string;
      lastSuccessAt: string | null;
    }>;
    const state = list.find((c) => c.id === "missing-secret");
    expect(state).toBeDefined();
    expect(state?.state).toBe("error");
    expect(state?.lastSuccessAt).toBeNull();
  });

  it("sets sync state to error and publishes status when a null secret reaches the invoker", async () => {
    const fixedNow = new Date("2026-11-12T10:00:00.000Z");
    const clock: import("@emos/core").Clock = { now: () => fixedNow };
    const events = createEventBus();
    const published: Array<{ type: string; connectorId: string; state: string }> = [];
    events.subscribe((e) => {
      if (e.type === "sync.status") {
        published.push(e as { type: string; connectorId: string; state: string });
      }
    });

    const nullConnector: ConnectorDefinition<unknown> = {
      id: "null-secret",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      clock,
      events,
      registry: [
        ...connectorRegistry,
        {
          def: nullConnector,
          createInvoker: (config) => {
            if ((config as { token?: unknown }).token === null) {
              throw new Error("token must not be null");
            }
            return fixtureInvoker({});
          },
        },
      ],
    });
    const client = clientFor(svc);

    // Seed a legacy row with a null secret value (the API's strict mode now rejects null, but
    // legacy rows and third-party edits can still produce it).
    svc.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(
        "connector_configs",
        JSON.stringify({
          "null-secret": { enabled: true, config: { token: null } },
        }),
      );

    const result = await client.call("connectors.sync", { id: "null-secret" });
    expect(result).toEqual({ pages: 0, items: 0 });

    const list = (await client.call("connectors.list", {})) as Array<{
      id: string;
      state: string;
      lastError: string | null;
    }>;
    const state = list.find((c) => c.id === "null-secret");
    expect(state).toBeDefined();
    expect(state?.state).toBe("error");
    expect(state?.lastError).toContain("token must not be null");

    const row = svc.db
      .prepare("SELECT last_attempt_at FROM sync_state WHERE connector_id = ?")
      .get<{ last_attempt_at: string }>("null-secret");
    expect(row?.last_attempt_at).toBe(fixedNow.toISOString());

    expect(published).toContainEqual({
      type: "sync.status",
      connectorId: "null-secret",
      state: "error",
    });
  });

  it("returns conflict when a second connectors.sync runs for the same id", async () => {
    const slowConnector: ConnectorDefinition<unknown> = {
      id: "slow",
      kind: "calendar",
      configSchema: z.object({}),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        await new Promise((r) => setTimeout(r, 500));
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        { def: slowConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);
    await client.call("connectors.configure", { id: "slow", enabled: true, config: {} });

    const first = client.call("connectors.sync", { id: "slow" });
    const second = client.call("connectors.sync", { id: "slow" });
    const [a, b] = await Promise.allSettled([first, second]);

    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("rejected");
    expect((b as PromiseRejectedResult).reason).toMatchObject({ code: "conflict" });
  });

  it("restores secrets before building a strict-schema invoker", async () => {
    let invokerConfig: unknown;
    let syncConfig: unknown;
    const strictConnector: ConnectorDefinition<unknown> = {
      id: "strict-secret",
      kind: "calendar",
      configSchema: z.object({ token: z.string() }),
      requiredCapabilities: ["fixture.ping"],
      defaultIntervalMinutes: 15,
      async *sync(ctx) {
        syncConfig = ctx.config;
        await ctx.caps.call("fixture.ping", {}, z.object({ ok: z.boolean() }));
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        {
          def: strictConnector,
          createInvoker: (config) => {
            invokerConfig = config;
            return fixtureInvoker({ "fixture.ping": [{ ok: true }] });
          },
        },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "strict-secret",
      enabled: true,
      config: { token: "PRESENT-TOKEN" },
    });
    await client.call("connectors.sync", { id: "strict-secret" });

    expect(invokerConfig).toEqual({ token: "PRESENT-TOKEN" });
    expect(syncConfig).toEqual({ token: "PRESENT-TOKEN" });
  });

  it("sets sync state to error when a strict-schema invoker is missing a secret", async () => {
    const strictConnector: ConnectorDefinition<unknown> = {
      id: "strict-missing",
      kind: "calendar",
      configSchema: z.object({ token: z.string() }),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      registry: [
        ...connectorRegistry,
        { def: strictConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "strict-missing",
      enabled: true,
      config: { token: "MISSING-SECRET" },
    });
    await svc.secrets.delete("connector:strict-missing:token");

    const result = await client.call("connectors.sync", { id: "strict-missing" });
    expect(result).toEqual({ pages: 0, items: 0 });

    const list = (await client.call("connectors.list", {})) as Array<{
      id: string;
      state: string;
      lastSuccessAt: string | null;
    }>;
    const state = list.find((c) => c.id === "strict-missing");
    expect(state).toBeDefined();
    expect(state?.state).toBe("error");
    expect(state?.lastSuccessAt).toBeNull();
  });

  it("truncates and strips control characters from persisted last_error", async () => {
    const fixedNow = new Date("2026-11-12T10:00:00.000Z");
    const clock: import("@emos/core").Clock = { now: () => fixedNow };
    const longMessage = "x\n\u001b[31m".padEnd(2500, "y");
    const throwingConnector: ConnectorDefinition<unknown> = {
      id: "long-error",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    const svc = await startTestService({
      clock,
      registry: [
        ...connectorRegistry,
        {
          def: throwingConnector,
          createInvoker: () => {
            throw new Error(longMessage);
          },
        },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "long-error",
      enabled: true,
      config: {},
    });

    const result = await client.call("connectors.sync", { id: "long-error" });
    expect(result).toEqual({ pages: 0, items: 0 });

    const row = svc.db
      .prepare("SELECT last_error FROM sync_state WHERE connector_id = ?")
      .get<{ last_error: string }>("long-error");
    expect(row).toBeDefined();
    expect(row?.last_error).toHaveLength(500);
    expect(row?.last_error).not.toContain("\n");
    expect(row?.last_error).not.toContain("\u001b");

    const list = (await client.call("connectors.list", {})) as Array<{
      id: string;
      lastError: string | null;
    }>;
    const state = list.find((c) => c.id === "long-error");
    expect(state?.lastError).toBe(row?.last_error);
  });

  it("sanitizes last_error when the connector sync() throws (not createInvoker)", async () => {
    const fixedNow = new Date("2026-11-12T10:00:00.000Z");
    const clock: import("@emos/core").Clock = { now: () => fixedNow };
    const { ConnectorError } = await import("@emos/connectors");
    const longMessage = "schema-failure\n\u001b[31m".padEnd(2500, "x");
    const throwingConnector: ConnectorDefinition<unknown> = {
      id: "sync-throws-error",
      kind: "calendar",
      configSchema: z.any(),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      sync(): AsyncIterable<import("@emos/connectors").SyncPage> {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => Promise.reject(new ConnectorError("schema", longMessage)),
              return: () => Promise.resolve({ done: true, value: undefined }),
            };
          },
        } as AsyncIterable<import("@emos/connectors").SyncPage>;
      },
    };
    const svc = await startTestService({
      clock,
      registry: [
        ...connectorRegistry,
        { def: throwingConnector, createInvoker: () => fixtureInvoker({}) },
      ],
    });
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "sync-throws-error",
      enabled: true,
      config: {},
    });

    const result = await client.call("connectors.sync", { id: "sync-throws-error" });
    expect(result).toEqual({ pages: 0, items: 0 });

    const row = svc.db
      .prepare("SELECT last_error FROM sync_state WHERE connector_id = ?")
      .get<{ last_error: string }>("sync-throws-error");
    expect(row).toBeDefined();
    expect(row?.last_error.length).toBeLessThanOrEqual(500);
    expect(row?.last_error).not.toContain("\n");
    expect(row?.last_error).not.toContain("\u001b");
    expect(row?.last_error).not.toMatch(/[\p{Cc}\p{Cf}]/u);

    const list = (await client.call("connectors.list", {})) as Array<{
      id: string;
      lastError: string | null;
    }>;
    const state = list.find((c) => c.id === "sync-throws-error");
    expect(state?.lastError).toBe(row?.last_error);
  });

  it("removes a connector config and deletes its keychain secrets", async () => {
    const svc = await startTestService();
    const client = clientFor(svc);

    await client.call("connectors.configure", {
      id: "synthetic-fixture",
      enabled: true,
      config: { secretKey: "to-remove" },
    });
    await expect(svc.secrets.get("connector:synthetic-fixture:secretKey")).resolves.toBe(
      "to-remove",
    );

    await client.call("connectors.remove", { id: "synthetic-fixture" });

    const row = svc.db
      .prepare("SELECT value FROM settings WHERE key = 'connector_configs'")
      .get<{ value: string }>();
    const configs = JSON.parse(row?.value ?? "{}") as Record<
      string,
      { enabled: boolean; config: unknown }
    >;
    expect(configs["synthetic-fixture"]).toBeUndefined();
    await expect(svc.secrets.get("connector:synthetic-fixture:secretKey")).resolves.toBeNull();
  });
});
