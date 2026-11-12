import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConnectorError } from "../runtime/errors.js";
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

  it("infers stdio from command when type is omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "emos-mcp-servers-"));
    const file = join(dir, "servers.json");
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          github: {
            command: "npx",
            args: ["-y", "server-github"],
          },
        },
      }),
    );

    const servers = loadServers(file);
    expect(servers).toEqual([
      {
        name: "github",
        type: "stdio",
        command: "npx",
        args: ["-y", "server-github"],
      },
    ] satisfies McpServerDef[]);
  });

  it("infers http from url when type is omitted", () => {
    const dir = mkdtempSync(join(tmpdir(), "emos-mcp-servers-"));
    const file = join(dir, "servers.json");
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          gateway: {
            url: "https://gateway.example.com/mcp",
          },
        },
      }),
    );

    const servers = loadServers(file);
    expect(servers).toEqual([
      {
        name: "gateway",
        type: "http",
        url: "https://gateway.example.com/mcp",
      },
    ] satisfies McpServerDef[]);
  });

  it("throws a config ConnectorError when a server has neither command nor url", () => {
    const dir = mkdtempSync(join(tmpdir(), "emos-mcp-servers-"));
    const file = join(dir, "servers.json");
    writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          bad: {},
        },
      }),
    );

    expect(() => loadServers(file)).toThrow(ConnectorError);
    expect(() => loadServers(file)).toThrow(/bad/);
    try {
      loadServers(file);
    } catch (e) {
      expect(e).toBeInstanceOf(ConnectorError);
      expect((e as ConnectorError).kind).toBe("config");
    }
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

    expect(() => loadServers(file)).toThrow(ConnectorError);
    expect(() => loadServers(file)).toThrow(/Invalid MCP servers file/);
  });
});
