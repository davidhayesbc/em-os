import type { SecretStore } from "@emos/core";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConnectorError } from "../runtime/errors.js";
import { createMcpInvoker, createMcpInvokerForTest } from "./invoker.js";
import type { PresetDef } from "./preset.js";
import type { McpServerDef } from "./servers.js";

const examplePreset: PresetDef = {
  preset: "example-calendar",
  server: "example-server",
  capabilities: {
    "calendar.listEvents": {
      tool: "list_events",
      args: { start: "{{timeMin}}", end: "{{timeMax}}", page: "{{cursor}}" },
      result: {
        items: "$.events[*]",
        nextCursor: "$.next",
        fields: {
          externalId: "id",
          title: "summary",
          start: "start.dateTime|start.date",
          end: "end.dateTime|end.date",
          attendees: "attendees",
          url: "htmlLink",
          status: "status",
          recurringEventId: "recurringEventId",
        },
      },
    },
  },
};

const memorySecretStore = (values: Record<string, string> = {}): SecretStore => ({
  get: async (key) => values[key] ?? null,
  set: async () => {},
  delete: async () => {},
});

async function createTestServer(): Promise<{ server: McpServer; transport: InMemoryTransport }> {
  const server = new McpServer({ name: "test-calendar", version: "1.0.0" });
  server.registerTool(
    "list_events",
    {
      inputSchema: z.object({
        start: z.string(),
        end: z.string(),
        page: z.string().optional(),
      }),
    },
    async (args: { start: string; end: string; page?: string }) => {
      const nextPage = args.page === "page-1" ? "page-2" : null;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              events: [
                {
                  id: "evt-1",
                  summary: "Sprint planning",
                  start: { dateTime: `${args.start}T10:00:00.000Z` },
                  end: { dateTime: `${args.end}T11:00:00.000Z` },
                  htmlLink: "https://cal.example.com/e/1",
                  status: "confirmed",
                  attendees: ["alex@example.com"],
                  recurringEventId: null,
                },
              ],
              next: nextPage,
            }),
          },
        ],
      };
    },
  );

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return { server, transport: clientTransport };
}

describe("createMcpInvoker", () => {
  it("refuses calendar.deleteEvent (not in preset)", async () => {
    const serverDef: McpServerDef = {
      name: "example-server",
      type: "stdio",
      command: "node",
    };
    const invoker = createMcpInvoker(serverDef, examplePreset, memorySecretStore());

    await expect(
      invoker.call("calendar.deleteEvent", {}, z.object({ ok: z.boolean() })),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ConnectorError && (e as ConnectorError).kind === "config",
    );
  });

  it("throws config for OAuth server", async () => {
    const serverDef: McpServerDef = {
      name: "oauth-server",
      type: "http",
      url: "https://oauth.example.com/mcp",
      auth: { kind: "oauth" },
    };

    await expect(async () => {
      const invoker = createMcpInvoker(serverDef, examplePreset, memorySecretStore());
      await invoker.call("calendar.listEvents", {}, z.object({}));
    }).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ConnectorError &&
        (e as ConnectorError).kind === "config" &&
        (e as ConnectorError).message === "OAuth server: use the fallback recorded in ADR 0005",
    );
  });

  it("throws config when bearer secret is missing", async () => {
    const serverDef: McpServerDef = {
      name: "gateway",
      type: "http",
      url: "https://gateway.example.com/mcp",
      auth: { kind: "bearer", secretKey: "gateway-token" },
    };

    const invoker = createMcpInvoker(serverDef, examplePreset, memorySecretStore());
    await expect(invoker.call("calendar.listEvents", {}, z.object({}))).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ConnectorError &&
        (e as ConnectorError).kind === "config" &&
        (e as ConnectorError).message === 'Bearer secret "gateway-token" is not set',
    );
  });

  it("creates only one transport for concurrent calls", async () => {
    const { transport } = await createTestServer();
    const serverDef: McpServerDef = {
      name: "example-server",
      type: "stdio",
      command: "node",
    };
    let createCalls = 0;
    const invoker = createMcpInvokerForTest(serverDef, examplePreset, memorySecretStore(), {
      createTransport: async () => {
        createCalls++;
        return transport;
      },
    });

    const schema = z.object({
      items: z.array(
        z.object({
          externalId: z.string(),
          title: z.string(),
          start: z.string(),
          end: z.string(),
          attendees: z.array(z.string()),
          url: z.string(),
          status: z.string(),
          recurringEventId: z.null(),
        }),
      ),
      nextCursor: z.string().nullable(),
    });

    const [a, b] = await Promise.all([
      invoker.call(
        "calendar.listEvents",
        { timeMin: "2026-10-20", timeMax: "2026-10-21", cursor: "" },
        schema,
      ),
      invoker.call(
        "calendar.listEvents",
        { timeMin: "2026-10-20", timeMax: "2026-10-21", cursor: "" },
        schema,
      ),
    ]);

    expect(createCalls).toBe(1);
    expect(a.items).toHaveLength(1);
    expect(b.items).toHaveLength(1);

    await invoker.close();
  });

  it("calls list_events against an in-process MCP server and returns mapped items + cursor", async () => {
    const { transport } = await createTestServer();
    const serverDef: McpServerDef = {
      name: "example-server",
      type: "stdio",
      command: "node",
    };
    const invoker = createMcpInvokerForTest(serverDef, examplePreset, memorySecretStore(), {
      createTransport: async () => transport,
    });

    const schema = z.object({
      items: z.array(
        z.object({
          externalId: z.string(),
          title: z.string(),
          start: z.string(),
          end: z.string(),
          attendees: z.array(z.string()),
          url: z.string(),
          status: z.string(),
          recurringEventId: z.null(),
        }),
      ),
      nextCursor: z.string().nullable(),
    });

    const result = await invoker.call(
      "calendar.listEvents",
      { timeMin: "2026-10-20", timeMax: "2026-10-21", cursor: "page-1" },
      schema,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      externalId: "evt-1",
      title: "Sprint planning",
      url: "https://cal.example.com/e/1",
      status: "confirmed",
    });
    expect(result.nextCursor).toBe("page-2");

    await invoker.close();
  });
});
