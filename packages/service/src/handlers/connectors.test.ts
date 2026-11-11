import { createClient, httpTransport } from "@emos/api-contract";
import { type ConnectorDefinition, fixtureInvoker } from "@emos/connectors";
import { afterEach, describe, expect, it } from "vitest";
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

  it("returns conflict when a second connectors.sync runs for the same id", async () => {
    const slowConnector: ConnectorDefinition<unknown> = {
      id: "slow",
      kind: "calendar",
      configSchema: (await import("zod")).z.object({}),
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
