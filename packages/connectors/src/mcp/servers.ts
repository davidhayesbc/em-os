import { readFileSync } from "node:fs";
import { z } from "zod";
import { ConnectorError } from "../runtime/errors.js";

const authSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("bearer"), secretKey: z.string() }),
  z.object({ kind: z.literal("oauth") }),
]);

const serverEntrySchema = z.object({
  type: z.union([z.literal("http"), z.literal("stdio")]).optional(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  auth: authSchema.optional(),
});

const serversFileSchema = z.object({
  mcpServers: z.record(z.string(), serverEntrySchema),
});

export interface McpServerDef {
  name: string;
  type: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: { kind: "none" } | { kind: "bearer"; secretKey: string } | { kind: "oauth" };
}

function inferServerType(entry: z.infer<typeof serverEntrySchema>, name: string): "http" | "stdio" {
  if (entry.type) return entry.type;
  if (entry.command) return "stdio";
  if (entry.url) return "http";
  throw new ConnectorError(
    "config",
    `MCP server "${name}" must specify command (stdio), url (http), or explicit type`,
  );
}

function parseServersFile(text: string): z.infer<typeof serversFileSchema> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return serversFileSchema.parse(parsed);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ConnectorError("config", `Invalid MCP servers file: ${message}`);
  }
}

/**
 * Parse a Claude Code `{ mcpServers: { ... } }` JSON file into an array of server
 * definitions, injecting the object key as `name`.
 */
export function loadServers(file: string): McpServerDef[] {
  const text = readFileSync(file, "utf8");
  const validated = parseServersFile(text);
  return Object.entries(validated.mcpServers).map(([name, server]) => ({
    name,
    ...server,
    type: inferServerType(server, name),
  }));
}
