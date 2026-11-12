import { createClient, httpTransport } from "@emos/api-contract";
import { type ConnectorDefinition, fixtureInvoker } from "@emos/connectors";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { connectorRegistry } from "../connectors/registry.js";
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
});
