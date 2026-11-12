import { readFileSync } from "node:fs";
import { z } from "zod";

const authSchema = z.union([
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("bearer"), secretKey: z.string() }),
  z.object({ kind: z.literal("oauth") }),
]);

const serverEntrySchema = z.object({
  type: z.union([z.literal("http"), z.literal("stdio")]),
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

/**
 * Parse a Claude Code `{ mcpServers: { ... } }` JSON file into an array of server
 * definitions, injecting the object key as `name`.
 */
export function loadServers(file: string): McpServerDef[] {
  const text = readFileSync(file, "utf8");
  const parsed = JSON.parse(text) as unknown;
  const validated = serversFileSchema.parse(parsed);
  return Object.entries(validated.mcpServers).map(([name, server]) => ({
    name,
    ...server,
  }));
}
