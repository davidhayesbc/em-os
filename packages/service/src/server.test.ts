import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { createServer, type Server } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { createClient, httpTransport, type ServerEvent } from "@emos/api-contract";
import { dataLayout } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { TOKEN_KEY } from "./auth.js";
import { DEFAULT_PORT, parseArgs, runtimePaths, shouldValidateOutput } from "./config.js";
import { createEventBus } from "./events.js";
import { createKeychainSecretStore, createMemorySecretStore } from "./secrets.js";
import { startService } from "./server.js";
import {
  authHeaders,
  cleanup,
  request,
  spyLogger,
  startTestService,
  tmpDir,
} from "./test-helpers.js";

const servers: Server[] = [];
afterEach(async () => {
  await cleanup();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  if (typeof r.pid !== "number") throw new Error("spawn failed");
  return r.pid;
}

/** Occupies an ephemeral loopback port and returns it. */
async function occupyPort(): Promise<number> {
  const s = createServer();
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const addr = s.address();
  if (addr === null || typeof addr === "string") throw new Error("no address");
  return addr.port;
}

function readServiceJson(dataDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(runtimePaths(dataDir).serviceJson, "utf8"));
}

describe("authentication", () => {
  it("rejects missing token", async () => {
    const svc = await startTestService();
    const res = await request(svc.port, { path: "/rpc/health.get", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it.each([
    ["a wrong token", "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["a truncated token", null],
    ["the wrong scheme", "Basic dXNlcjpwYXNz"],
  ])("rejects %s with 401 unauthorized", async (_label, header) => {
    const svc = await startTestService();
    const authorization = header ?? `Bearer ${svc.token.slice(0, -1)}`;
    const res = await request(svc.port, {
      path: "/rpc/health.get",
      headers: { ...authHeaders(svc.token), authorization },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("the real client surfaces a wrong token as ApiError(unauthorized)", async () => {
    const svc = await startTestService();
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: "wrong",
    });
    await expect(client.call("health.get", {})).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("requires auth before revealing whether a route exists", async () => {
    const svc = await startTestService();
    for (const path of ["/rpc/nope", "/whatever", "/events"]) {
      const res = await request(svc.port, { method: "GET", path });
      expect(res.status).toBe(401);
    }
  });

  it.each([
    ["missing", undefined],
    ["mismatched", "2"],
    ["non-numeric", "one"],
  ])("rejects a %s X-EMOS-API header with 409 incompatible_version", async (_l, version) => {
    const svc = await startTestService();
    const headers = authHeaders(svc.token);
    if (version === undefined) delete headers["x-emos-api"];
    else headers["x-emos-api"] = version;
    const res = await request(svc.port, { path: "/rpc/health.get", headers, body: "{}" });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ ok: false, error: { code: "incompatible_version" } });
  });

  it("GET /health/ping needs no auth and returns 200 ok", async () => {
    const svc = await startTestService();
    const res = await request(svc.port, { method: "GET", path: "/health/ping" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("ok");
  });

  it.each([
    "evil.example.com",
    "evil.example.com:PORT",
    "localhost.example.com:PORT",
    "127.0.0.1:1",
  ])("rejects Host %s with 403 (DNS-rebinding protection), even on /health/ping", async (h) => {
    const svc = await startTestService();
    const host = h.replace("PORT", String(svc.port));
    for (const path of ["/health/ping", "/rpc/health.get"]) {
      const res = await request(svc.port, {
        method: path === "/health/ping" ? "GET" : "POST",
        path,
        headers: { ...authHeaders(svc.token), host },
        body: path === "/health/ping" ? undefined : "{}",
      });
      expect(res.status).toBe(403);
    }
  });

  it("accepts Host localhost:<port>", async () => {
    const svc = await startTestService();
    const res = await request(svc.port, {
      path: "/rpc/health.get",
      headers: { ...authHeaders(svc.token), host: `localhost:${svc.port}` },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("sends no CORS headers, even to a request with an Origin", async () => {
    const svc = await startTestService();
    for (const method of ["OPTIONS", "POST"]) {
      const res = await request(svc.port, {
        method,
        path: "/rpc/health.get",
        headers: {
          ...authHeaders(svc.token),
          origin: "https://evil.example.com",
          "access-control-request-method": "POST",
        },
        body: method === "POST" ? "{}" : undefined,
      });
      const cors = Object.keys(res.headers).filter((h) => h.startsWith("access-control-"));
      expect(cors).toEqual([]);
    }
  });
});

describe("runtime files", () => {
  it("writes service.json, a 0o600 token file and the lock; stop() removes service.json and the lock", async () => {
    const svc = await startTestService();
    const paths = runtimePaths(realpathSync(svc.dataDir));
    expect(readServiceJson(svc.dataDir)).toEqual({
      pid: process.pid,
      port: svc.port,
      apiVersion: 1,
      serviceVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
      startedAt: expect.stringMatching(/Z$/),
    });
    expect(readFileSync(paths.token, "utf8")).toBe(svc.token);
    expect(readFileSync(paths.lock, "utf8").trim()).toBe(String(process.pid));
    if (process.platform !== "win32") {
      expect(statSync(paths.token).mode & 0o777).toBe(0o600);
      expect(statSync(paths.runDir).mode & 0o777).toBe(0o700);
    }
    await svc.stop();
    expect(existsSync(paths.serviceJson)).toBe(false);
    expect(existsSync(paths.lock)).toBe(false);
  });

  it("stores the token in the secret store under emos/token and reuses it on restart", async () => {
    const secrets = createMemorySecretStore();
    const dataDir = tmpDir();
    const first = await startTestService({ dataDir, secrets });
    expect(await secrets.get(TOKEN_KEY)).toBe(first.token);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await first.stop();
    const second = await startTestService({ dataDir, secrets });
    expect(second.token).toBe(first.token);
  });

  it("creates the database under db/", async () => {
    const svc = await startTestService();
    expect(existsSync(dataLayout(realpathSync(svc.dataDir)).dbFile)).toBe(true);
  });

  it("creates a missing data dir", async () => {
    const dataDir = join(tmpDir(), "nested", "EM OS");
    const svc = await startTestService({ dataDir });
    expect(existsSync(runtimePaths(realpathSync(svc.dataDir)).serviceJson)).toBe(true);
  });

  it("refuses a data dir inside a git checkout, and leaves no runtime files", async () => {
    const repo = tmpDir();
    mkdirSync(join(repo, ".git"));
    const dataDir = join(repo, "data");
    await expect(startTestService({ dataDir })).rejects.toThrow(/inside a git checkout/);
    expect(existsSync(join(dataDir, "run"))).toBe(false);
  });

  it("stop() is idempotent", async () => {
    const svc = await startTestService();
    await svc.stop();
    await expect(svc.stop()).resolves.toBeUndefined();
  });
});

describe("single instance", () => {
  it("second startService on same dataDir throws 'already running'", async () => {
    const svc = await startTestService();
    await expect(startTestService({ dataDir: svc.dataDir })).rejects.toThrow(/already running/);
    // The failed second start must not disturb the first instance's runtime files.
    expect(readServiceJson(svc.dataDir).port).toBe(svc.port);
    const res = await request(svc.port, { method: "GET", path: "/health/ping" });
    expect(res.status).toBe(200);
  });

  it("reclaims a stale lock whose pid is dead", async () => {
    const dataDir = tmpDir();
    const paths = runtimePaths(dataDir);
    mkdirSync(paths.runDir, { recursive: true });
    const stale = deadPid();
    writeFileSync(paths.lock, String(stale));
    writeFileSync(paths.serviceJson, JSON.stringify({ pid: stale, port: 1 }));
    const svc = await startTestService({ dataDir });
    expect(readServiceJson(dataDir)).toMatchObject({ pid: process.pid, port: svc.port });
  });

  it("can start again after stop()", async () => {
    const dataDir = tmpDir();
    const a = await startTestService({ dataDir });
    await a.stop();
    const b = await startTestService({ dataDir });
    expect(readServiceJson(dataDir).port).toBe(b.port);
  });
});

describe("network", () => {
  it("binds 127.0.0.1 only", async () => {
    const svc = await startTestService();
    expect(svc.host).toBe("127.0.0.1");
  });

  const external = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

  it.runIf(external !== undefined)("is not reachable on a non-loopback interface", async () => {
    const svc = await startTestService();
    const outcome = await new Promise<string>((resolve) => {
      const req = httpRequest(
        { host: external, port: svc.port, path: "/health/ping", timeout: 2000 },
        (res) => {
          res.resume();
          resolve(`status ${res.statusCode}`);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
      req.end();
    });
    expect(outcome).not.toMatch(/^status/);
  });

  it("falls back to an ephemeral port when the preferred port is taken", async () => {
    const taken = await occupyPort();
    const svc = await startTestService({ port: taken });
    expect(svc.port).not.toBe(taken);
    expect(svc.port).toBeGreaterThan(0);
    expect(readServiceJson(svc.dataDir).port).toBe(svc.port);
    const res = await request(svc.port, { method: "GET", path: "/health/ping" });
    expect(res.text).toBe("ok");
  });

  it("uses the preferred port when it is free", async () => {
    const port = await occupyPort();
    await new Promise((r) => servers.pop()?.close(r)); // free it again
    const svc = await startTestService({ port });
    expect(svc.port).toBe(port);
  });
});

/** Opens GET /events and collects the raw stream. */
function openEvents(
  port: number,
  token: string,
): Promise<{ res: IncomingMessage; received: () => string; close: () => void }> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path: "/events",
        headers: { authorization: `Bearer ${token}`, "x-emos-api": "1" },
        agent: false,
      },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          buf += c;
        });
        resolve({ res, received: () => buf, close: () => req.destroy() });
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "ECONNRESET") reject(e);
    });
    req.end();
  });
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("GET /events (SSE)", () => {
  it("streams items.changed events over SSE", async () => {
    const events = createEventBus();
    const svc = await startTestService({ events });
    const stream = await openEvents(svc.port, svc.token);
    expect(stream.res.statusCode).toBe(200);
    expect(stream.res.headers["content-type"]).toMatch(/^text\/event-stream/);
    await waitFor(() => events.size === 1);

    const e: ServerEvent = { type: "items.changed", entity: "commitment", ids: ["cmt_1"] };
    events.publish(e);
    await waitFor(() => stream.received().includes("data: "));
    const line = stream
      .received()
      .split("\n")
      .find((l) => l.startsWith("data: "));
    expect(JSON.parse(line?.slice("data: ".length) ?? "")).toEqual(e);
    expect(stream.received()).toMatch(/data: .*\n\n/);
    stream.close();
  });

  it("sends a comment heartbeat on the configured interval", async () => {
    const svc = await startTestService({ heartbeatMs: 20 });
    const stream = await openEvents(svc.port, svc.token);
    await waitFor(() => stream.received().includes(": heartbeat\n\n"));
    stream.close();
  });

  it("unsubscribes when the client closes", async () => {
    const events = createEventBus();
    const svc = await startTestService({ events });
    const stream = await openEvents(svc.port, svc.token);
    await waitFor(() => events.size === 1);
    stream.close();
    await waitFor(() => events.size === 0);
  });

  it("requires the bearer token", async () => {
    const svc = await startTestService();
    const res = await request(svc.port, { method: "GET", path: "/events" });
    expect(res.status).toBe(401);
  });

  it("stop() ends open streams", async () => {
    const events = createEventBus();
    const svc = await startTestService({ events });
    const stream = await openEvents(svc.port, svc.token);
    await waitFor(() => events.size === 1);
    const ended = new Promise<void>((r) => stream.res.on("close", () => r()));
    await svc.stop();
    await ended;
    expect(events.size).toBe(0);
  });
});

describe("secrets", () => {
  it("secrets round-trip through the keychain and never appear in logs", async () => {
    const log = spyLogger();
    const secrets = createMemorySecretStore();
    const svc = await startTestService({ log, secrets });
    // The service stored the token and reads it back on restart.
    expect(await secrets.get(TOKEN_KEY)).toBe(svc.token);
    const wrong = "W".repeat(43);
    await request(svc.port, {
      path: "/rpc/health.get",
      headers: { ...authHeaders(svc.token), authorization: `Bearer ${wrong}` },
      body: "{}",
    });
    await request(svc.port, {
      path: "/rpc/health.get",
      headers: authHeaders(svc.token),
      body: "{}",
    });
    await svc.stop();
    const again = await startTestService({ log, secrets, dataDir: svc.dataDir });
    expect(again.token).toBe(svc.token);
    await again.stop();

    expect(log.calls.length).toBeGreaterThan(0); // the spy is actually wired in
    const logged = JSON.stringify(log.calls);
    expect(logged).not.toContain(svc.token);
    expect(logged).not.toContain(wrong);
  });

  it("the memory store round-trips and deletes", async () => {
    const s = createMemorySecretStore();
    expect(await s.get("k")).toBeNull();
    await s.set("k", "v");
    expect(await s.get("k")).toBe("v");
    await s.delete("k");
    expect(await s.get("k")).toBeNull();
    await expect(s.delete("k")).resolves.toBeUndefined();
  });

  it.runIf(process.env.EMOS_TEST_KEYCHAIN === "1")(
    "round-trips through the real OS keychain (EMOS_TEST_KEYCHAIN=1)",
    async () => {
      const s = createKeychainSecretStore("em-os-test");
      const key = `emos/test-${randomUUID()}`;
      try {
        expect(await s.get(key)).toBeNull();
        await s.set(key, "synthetic-secret");
        expect(await s.get(key)).toBe("synthetic-secret");
      } finally {
        await s.delete(key);
      }
      expect(await s.get(key)).toBeNull();
    },
  );
});

describe("startService defaults", () => {
  it("default port is 47821", () => {
    expect(DEFAULT_PORT).toBe(47821);
  });

  it("rejects when the service cannot start, releasing the lock", async () => {
    const dataDir = tmpDir();
    const failing = {
      get: async () => {
        throw new Error("keychain locked");
      },
      set: async () => {},
      delete: async () => {},
    };
    await expect(
      startService({ dataDir, port: 0, secrets: failing, log: spyLogger() }),
    ).rejects.toThrow(/keychain locked/);
    expect(existsSync(runtimePaths(dataDir).lock)).toBe(false);
    expect(existsSync(runtimePaths(dataDir).serviceJson)).toBe(false);
    // and a normal start works afterwards
    await startTestService({ dataDir });
  });
});

describe("shouldValidateOutput", () => {
  it("validates handler output except in production", () => {
    expect(shouldValidateOutput({})).toBe(true);
    expect(shouldValidateOutput({ NODE_ENV: "test" })).toBe(true);
    expect(shouldValidateOutput({ NODE_ENV: "development" })).toBe(true);
    expect(shouldValidateOutput({ NODE_ENV: "production" })).toBe(false);
  });
});

describe("parseArgs", () => {
  const home = "/Users/zoë q";
  it("defaults the data dir and port", () => {
    expect(parseArgs([], {}, "darwin", home)).toEqual({
      dataDir: "/Users/zoë q/Library/Application Support/EM OS",
      port: DEFAULT_PORT,
    });
  });

  it("reads --data-dir and --port in both forms", () => {
    expect(parseArgs(["--data-dir", "/d/EM OS", "--port", "5000"], {}, "darwin", home)).toEqual({
      dataDir: "/d/EM OS",
      port: 5000,
    });
    expect(parseArgs(["--data-dir=/x", "--port=0"], {}, "linux", home)).toEqual({
      dataDir: "/x",
      port: 0,
    });
  });

  it("honours EMOS_DATA_DIR", () => {
    expect(parseArgs([], { EMOS_DATA_DIR: "/e" }, "darwin", home).dataDir).toBe("/e");
  });

  it.each([
    ["--port", "-1"],
    ["--port", "65536"],
    ["--port", "abc"],
    ["--port", "1.5"],
    ["--nope"],
  ])("rejects %j", (...args) => {
    expect(() => parseArgs(args, {}, "darwin", home)).toThrow();
  });
});
