import http from "node:http";
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

interface LoopbackResponse {
  status: number;
  body: string;
  contentType?: string;
}

function startMcpLoopback(
  handler: (req: http.IncomingMessage, body: string) => LoopbackResponse,
): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const result = handler(req, body);
        const headers: Record<string, string> = {};
        if (result.contentType) {
          headers["content-type"] = result.contentType;
        }
        res.writeHead(result.status, headers);
        res.end(result.body);
      });
      req.on("error", (err) => {
        res.writeHead(500);
        res.end(String(err));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close(() => reject(new Error("Invalid server address")));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/mcp`,
        stop: () => new Promise((res) => server.close(() => res())),
      });
    });
    server.on("error", reject);
  });
}

function initializeResponse(msg: { id?: number | string }): LoopbackResponse {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: { name: "test", version: "1.0.0" },
      },
    }),
  };
}

describe("createMcpInvoker", () => {
  it("redacts an echoed Authorization header from a 400 response", async () => {
    const token = "super-secret-token-123";
    const { url, stop } = await startMcpLoopback((req, body) => {
      const auth = req.headers.authorization ?? "";
      if (req.method === "GET") {
        return { status: 405, body: "Method Not Allowed" };
      }
      const msg = JSON.parse(body);
      if (msg.method === "initialize") {
        return initializeResponse(msg);
      }
      if (msg.method === "notifications/initialized") {
        return { status: 200, body: "" };
      }
      return { status: 400, body: `bad request; you sent ${auth}` };
    });

    const serverDef: McpServerDef = {
      name: "gateway",
      type: "http",
      url,
      auth: { kind: "bearer", secretKey: "mcp:gateway:token" },
    };
    const invoker = createMcpInvoker(
      serverDef,
      examplePreset,
      memorySecretStore({ "mcp:gateway:token": token }),
    );

    await expect(
      invoker.call(
        "calendar.listEvents",
        { timeMin: "2026-10-20", timeMax: "2026-10-21", cursor: "" },
        z.object({}),
      ),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ConnectorError);
      const ce = e as ConnectorError;
      expect(ce.kind).toBe("auth");
      expect(ce.message).not.toContain(token);
      expect(ce.message).toContain('"gateway"');
      expect(ce.message).toContain("400");
      return true;
    });

    await invoker.close();
    await stop();
  });

  it("does not leak non-JSON tool result text in schema errors", async () => {
    const token = "secret-token-in-text";
    const { url, stop } = await startMcpLoopback((req, body) => {
      if (req.method === "GET") {
        return { status: 405, body: "Method Not Allowed" };
      }
      const msg = JSON.parse(body);
      if (msg.method === "initialize") {
        return initializeResponse(msg);
      }
      if (msg.method === "notifications/initialized") {
        return { status: 200, body: "" };
      }
      return {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: `this is not json; token=${token}` }],
            isError: false,
          },
        }),
      };
    });

    const serverDef: McpServerDef = { name: "gateway", type: "http", url };
    const invoker = createMcpInvoker(serverDef, examplePreset, memorySecretStore());

    await expect(invoker.call("calendar.listEvents", {}, z.object({}))).rejects.toSatisfy(
      (e: unknown) => {
        expect(e).toBeInstanceOf(ConnectorError);
        const ce = e as ConnectorError;
        expect(ce.kind).toBe("schema");
        expect(ce.message).not.toContain(token);
        return true;
      },
    );

    await invoker.close();
    await stop();
  });

  it("classifies a 401 echoed Authorization header as auth", async () => {
    const token = "another-secret";
    const { url, stop } = await startMcpLoopback((req, body) => {
      const auth = req.headers.authorization ?? "";
      if (req.method === "GET") {
        return { status: 405, body: "Method Not Allowed" };
      }
      const msg = JSON.parse(body);
      if (msg.method === "initialize") {
        return initializeResponse(msg);
      }
      if (msg.method === "notifications/initialized") {
        return { status: 200, body: "" };
      }
      return { status: 401, body: `unauthorized; you sent ${auth}` };
    });

    const serverDef: McpServerDef = {
      name: "gateway",
      type: "http",
      url,
      auth: { kind: "bearer", secretKey: "mcp:gateway:token" },
    };
    const invoker = createMcpInvoker(
      serverDef,
      examplePreset,
      memorySecretStore({ "mcp:gateway:token": token }),
    );

    await expect(invoker.call("calendar.listEvents", {}, z.object({}))).rejects.toSatisfy(
      (e: unknown) => {
        expect(e).toBeInstanceOf(ConnectorError);
        const ce = e as ConnectorError;
        expect(ce.kind).toBe("auth");
        expect(ce.message).not.toContain(token);
        expect(ce.message).toContain("401");
        return true;
      },
    );

    await invoker.close();
    await stop();
  });

  it("only resolves namespaced MCP secrets", async () => {
    const token = "mcp-secret";
    const captured: string[] = [];
    const { url, stop } = await startMcpLoopback((req, body) => {
      captured.push(req.headers.authorization ?? "");
      if (req.method === "GET") {
        return { status: 405, body: "Method Not Allowed" };
      }
      const msg = JSON.parse(body);
      if (msg.method === "initialize") {
        return initializeResponse(msg);
      }
      if (msg.method === "notifications/initialized") {
        return { status: 200, body: "" };
      }
      return {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ events: [] }) }],
            isError: false,
          },
        }),
      };
    });

    const secrets = memorySecretStore({
      "emos/token": "emos-value",
      "connector:c1:token": "connector-value",
      "mcp:gateway:token": token,
    });

    const validDef: McpServerDef = {
      name: "gateway",
      type: "http",
      url,
      auth: { kind: "bearer", secretKey: "mcp:gateway:token" },
    };
    const validInvoker = createMcpInvoker(validDef, examplePreset, secrets);
    await validInvoker.call(
      "calendar.listEvents",
      { timeMin: "2026-10-20", timeMax: "2026-10-21", cursor: "" },
      z.object({ items: z.array(z.any()), nextCursor: z.null() }),
    );
    expect(captured).toContain(`Bearer ${token}`);
    await validInvoker.close();

    await expect(
      createMcpInvoker(
        { name: "gateway", type: "http", url, auth: { kind: "bearer", secretKey: "emos/token" } },
        examplePreset,
        secrets,
      ).call("calendar.listEvents", {}, z.object({})),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ConnectorError);
      const ce = e as ConnectorError;
      expect(ce.kind).toBe("config");
      expect(ce.message).toContain("emos/token");
      expect(ce.message).not.toContain("emos-value");
      return true;
    });

    await expect(
      createMcpInvoker(
        {
          name: "gateway",
          type: "http",
          url,
          auth: { kind: "bearer", secretKey: "connector:c1:token" },
        },
        examplePreset,
        secrets,
      ).call("calendar.listEvents", {}, z.object({})),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ConnectorError);
      const ce = e as ConnectorError;
      expect(ce.kind).toBe("config");
      expect(ce.message).toContain("connector:c1:token");
      expect(ce.message).not.toContain("connector-value");
      return true;
    });

    await stop();
  });

  it("refuses prototype-polluting capability names", async () => {
    const serverDef: McpServerDef = { name: "example-server", type: "stdio", command: "node" };
    const invoker = createMcpInvoker(serverDef, examplePreset, memorySecretStore());

    for (const capability of [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
    ]) {
      await expect(invoker.call(capability, {}, z.object({}))).rejects.toSatisfy(
        (e: unknown) => e instanceof ConnectorError && (e as ConnectorError).kind === "config",
      );
    }
  });

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
      auth: { kind: "bearer", secretKey: "mcp:gateway:token" },
    };

    const invoker = createMcpInvoker(serverDef, examplePreset, memorySecretStore());
    await expect(invoker.call("calendar.listEvents", {}, z.object({}))).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ConnectorError &&
        (e as ConnectorError).kind === "config" &&
        (e as ConnectorError).message === 'Bearer secret "mcp:gateway:token" is not set',
    );
  });

  it("throws config when bearer secret key is not namespaced", async () => {
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
        (e as ConnectorError).message.includes("gateway-token"),
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

  it("retries transport creation after a transient connect failure", async () => {
    const serverDef: McpServerDef = {
      name: "example-server",
      type: "stdio",
      command: "node",
    };
    let createCalls = 0;
    const invoker = createMcpInvokerForTest(serverDef, examplePreset, memorySecretStore(), {
      createTransport: async () => {
        createCalls++;
        if (createCalls === 1) {
          throw new Error("socket hang up");
        }
        const { transport } = await createTestServer();
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

    await expect(
      invoker.call(
        "calendar.listEvents",
        { timeMin: "2026-10-20", timeMax: "2026-10-21", cursor: "" },
        schema,
      ),
    ).rejects.toThrow("socket hang up");

    const result = await invoker.call(
      "calendar.listEvents",
      { timeMin: "2026-10-20", timeMax: "2026-10-21", cursor: "" },
      schema,
    );

    expect(createCalls).toBe(2);
    expect(result.items).toHaveLength(1);

    await invoker.close();
  });

  it("closes cleanly after a failed connect", async () => {
    const serverDef: McpServerDef = {
      name: "example-server",
      type: "stdio",
      command: "node",
    };
    let createCalls = 0;
    const invoker = createMcpInvokerForTest(serverDef, examplePreset, memorySecretStore(), {
      createTransport: async () => {
        createCalls++;
        throw new Error("socket hang up");
      },
    });

    const schema = z.object({ items: z.array(z.object({ id: z.string() })), nextCursor: z.null() });

    await expect(invoker.call("calendar.listEvents", {}, schema)).rejects.toThrow("socket hang up");
    await expect(invoker.close()).resolves.toBeUndefined();
    expect(createCalls).toBe(1);
  });
});
