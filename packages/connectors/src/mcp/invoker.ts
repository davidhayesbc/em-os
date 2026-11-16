import type { SecretStore } from "@emos/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { z } from "zod";
import { ConnectorError } from "../runtime/errors.js";
import { classifyNetworkError } from "../runtime/network.js";
import type { CapabilityInvoker } from "../runtime/types.js";
import { applyResultMapping, type ResultMapping } from "./map.js";
import type { PresetDef } from "./preset.js";
import type { McpServerDef } from "./servers.js";

export interface McpInvoker extends CapabilityInvoker {
  close(): Promise<void>;
}

export interface McpInvokerDeps {
  createTransport?(server: McpServerDef, secrets: SecretStore): Promise<Transport>;
}

function validateMcpSecretKey(server: McpServerDef, secretKey: string): void {
  const expectedPrefix = `mcp:${server.name}:`;
  if (!secretKey.startsWith(expectedPrefix)) {
    throw new ConnectorError(
      "config",
      `Bearer secret key "${secretKey}" must be a namespaced MCP secret for server "${server.name}"`,
    );
  }
  const secretName = secretKey.slice(expectedPrefix.length);
  if (secretName.length === 0 || secretName.includes(":")) {
    throw new ConnectorError(
      "config",
      `Bearer secret key "${secretKey}" is not a valid namespaced MCP secret`,
    );
  }
}

async function readBearerToken(server: McpServerDef, secrets: SecretStore): Promise<string | null> {
  if (server.auth?.kind !== "bearer") return null;
  const secretKey = server.auth.secretKey;
  validateMcpSecretKey(server, secretKey);
  let token: string;
  try {
    const stored = await secrets.get(secretKey);
    if (stored === null) {
      throw new ConnectorError("config", `Bearer secret "${secretKey}" is not set`);
    }
    token = stored;
  } catch (e) {
    if (e instanceof ConnectorError) {
      throw e;
    }
    throw new ConnectorError("config", `Failed to read bearer secret for "${server.name}"`);
  }
  return token;
}

function extractHttpStatus(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null) {
    if ("code" in e && typeof (e as { code?: unknown }).code === "number") {
      return (e as { code: number }).code;
    }
    if ("status" in e && typeof (e as { status?: unknown }).status === "number") {
      return (e as { status: number }).status;
    }
  }
  return undefined;
}

function statusToKind(status: number): "auth" | "transient" | "offline" | "config" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || status >= 500) return "transient";
  return "config";
}

function wrapTransportError(server: McpServerDef, e: unknown): never {
  if (e instanceof ConnectorError) {
    throw e;
  }
  const status = extractHttpStatus(e);
  if (status !== undefined && status > 0) {
    throw new ConnectorError(
      statusToKind(status),
      `MCP transport error for "${server.name}" (status ${status})`,
    );
  }
  const network = classifyNetworkError(e);
  if (network === "offline") {
    throw new ConnectorError("offline", `MCP transport error for "${server.name}" (offline)`);
  }
  throw new ConnectorError("transient", `MCP transport error for "${server.name}"`);
}

async function defaultCreateTransport(
  server: McpServerDef,
  secrets: SecretStore,
): Promise<Transport> {
  if (server.type === "stdio") {
    if (!server.command) {
      throw new ConnectorError("config", `stdio server "${server.name}" is missing command`);
    }
    const env: Record<string, string> = { ...server.env };
    const token = await readBearerToken(server, secrets);
    if (token !== null) {
      env.EMOS_MCP_BEARER_TOKEN = token;
    }
    return new StdioClientTransport({
      command: server.command,
      args: server.args,
      env,
    });
  }

  if (server.type === "http") {
    if (!server.url) {
      throw new ConnectorError("config", `http server "${server.name}" is missing url`);
    }
    const headers: Record<string, string> = {};
    const token = await readBearerToken(server, secrets);
    if (token !== null) {
      headers.Authorization = `Bearer ${token}`;
    }
    let url: URL;
    try {
      url = new URL(server.url);
    } catch {
      throw new ConnectorError("config", `Malformed URL for http server "${server.name}"`);
    }
    return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  }

  throw new ConnectorError("config", `Unsupported MCP server type for "${server.name}"`);
}

function substituteArgs(
  template: Record<string, string>,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value !== "string") {
      result[key] = value;
      continue;
    }
    result[key] = value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name) => {
      const subst = args[name];
      return subst === undefined || subst === null ? "" : String(subst);
    });
  }
  return result;
}

function extractJsonText(result: unknown): unknown {
  const typed = result as { content?: { type: string; text?: string }[]; isError?: boolean };
  if (!Array.isArray(typed.content)) {
    throw new ConnectorError("schema", "Tool result has no text content array");
  }
  const text = typed.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  if (text.length === 0) {
    throw new ConnectorError("schema", "Tool result text content is empty");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ConnectorError("schema", "Tool result text content is not valid JSON");
  }
}

function makeMcpInvoker(
  server: McpServerDef,
  preset: PresetDef,
  secrets: SecretStore,
  deps: McpInvokerDeps,
): McpInvoker {
  let clientPromise: Promise<Client> | undefined;

  async function ensureClient(): Promise<Client> {
    clientPromise ??= (async () => {
      if (server.auth?.kind === "oauth") {
        throw new ConnectorError("config", "OAuth server: use the fallback recorded in ADR 0005");
      }
      const createTransport = deps.createTransport ?? defaultCreateTransport;
      const transport = await createTransport(server, secrets);
      const client = new Client({ name: "em-os-connectors", version: "0.0.0" });
      await client.connect(transport).catch((e) => wrapTransportError(server, e));
      return client;
    })().catch((e) => {
      clientPromise = undefined;
      throw e;
    });
    return clientPromise;
  }

  return {
    async call<T>(
      capability: string,
      args: Record<string, unknown>,
      schema: z.ZodType<T>,
    ): Promise<T> {
      const mapping = Object.hasOwn(preset.capabilities, capability)
        ? preset.capabilities[capability]
        : undefined;
      if (!mapping) {
        throw new ConnectorError(
          "config",
          `Capability ${capability} is not defined in preset ${preset.preset}`,
        );
      }

      const client = await ensureClient();
      const toolArgs = substituteArgs(mapping.args, args);
      const rawResult = await client
        .callTool({ name: mapping.tool, arguments: toolArgs })
        .catch((e) => wrapTransportError(server, e));
      const parsed = extractJsonText(rawResult);
      const mapped = applyResultMapping(parsed, mapping.result as ResultMapping);
      const validated = schema.safeParse(mapped);
      if (!validated.success) {
        throw new ConnectorError("schema", `Mapped result for ${capability} failed validation`);
      }
      return validated.data;
    },

    async close(): Promise<void> {
      const client = await clientPromise;
      if (client) {
        await client.close();
      }
    },
  };
}

/**
 * Create a capability invoker backed by an MCP server and a YAML preset. Capabilities
 * not listed in the preset are refused. OAuth servers are rejected until ADR 0005
 * records the owner spike result.
 */
export function createMcpInvoker(
  server: McpServerDef,
  preset: PresetDef,
  secrets: SecretStore,
): McpInvoker {
  return makeMcpInvoker(server, preset, secrets, {});
}

/** Test-only helper that allows injecting a transport factory. */
export function createMcpInvokerForTest(
  server: McpServerDef,
  preset: PresetDef,
  secrets: SecretStore,
  deps: McpInvokerDeps,
): McpInvoker {
  return makeMcpInvoker(server, preset, secrets, deps);
}
