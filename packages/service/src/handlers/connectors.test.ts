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
