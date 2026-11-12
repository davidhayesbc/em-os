import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadServers, type McpServerDef } from "./servers.js";

describe("loadServers", () => {
  it("parses the Claude Code mcpServers JSON shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "emos-mcp-servers-"));
    const file = join(dir, "servers.json");
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          "example-server": {
            type: "stdio",
            command: "node",
            args: ["example-server.js"],
            env: { LOG_LEVEL: "warn" },
            auth: { kind: "none" },
          },
          "example-gateway": {
            type: "http",
            url: "https://gateway.example.com/mcp",
            auth: { kind: "bearer", secretKey: "example-gateway-token" },
          },
        },
      }),
    );

    const servers = loadServers(file);
    expect(servers).toEqual([
      {
        name: "example-server",
        type: "stdio",
        command: "node",
        args: ["example-server.js"],
        env: { LOG_LEVEL: "warn" },
        auth: { kind: "none" },
      },
      {
        name: "example-gateway",
        type: "http",
        url: "https://gateway.example.com/mcp",
        auth: { kind: "bearer", secretKey: "example-gateway-token" },
      },
    ] satisfies McpServerDef[]);
  });

  it("throws on invalid auth kind", () => {
    const dir = mkdtempSync(join(tmpdir(), "emos-mcp-servers-"));
    const file = join(dir, "servers.json");
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          bad: { type: "stdio", command: "node", auth: { kind: "digest" } },
        },
      }),
    );

    expect(() => loadServers(file)).toThrow();
  });
});
