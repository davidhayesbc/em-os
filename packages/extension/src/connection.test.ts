import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type ServerEvent } from "@emos/api-contract";
import { createEventBus, createMemorySecretStore, startService } from "@emos/service";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ConnectionState, createSseParser, ServiceConnection } from "./connection.js";
import { createLauncher } from "./launcher.js";
import { readToken } from "./runtime.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

/** A real service on an ephemeral port in a temp data dir, with in-memory secrets. */
async function realService() {
  const dataDir = mkdtempSync(join(tmpdir(), "emos ext zoë-"));
  const events = createEventBus();
  const svc = await startService({
    dataDir,
    port: 0,
    secrets: createMemorySecretStore(),
    events,
    log: { info() {}, warn() {}, error() {} },
  });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await svc.stop();
  };
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  cleanups.push(stop);
  return { dataDir, events, svc, stop };
}

/**
 * A fake service for the token tests: RPC needs `goodToken` (401 `unauthorized` otherwise);
 * `/events` streams, checking the token only with `authEvents`.
 */
async function fakeService(opts: { authEvents?: boolean } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "emos ext zoë-"));
  mkdirSync(join(dataDir, "run"), { recursive: true });
  const goodToken = "g".repeat(43);
  let rpc = 0;
  let sse = 0;
  const open = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    const authed = req.headers.authorization === `Bearer ${goodToken}`;
    const versioned = req.headers["x-emos-api"] === "1";
    if (req.url === "/events") {
      sse++;
      if ((opts.authEvents && !authed) || !versioned) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { code: "unauthorized", message: "no" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": connected\n\n");
      open.add(res);
      res.on("close", () => open.delete(res));
      return;
    }
    rpc++;
    res.setHeader("content-type", "application/json");
    if (!authed) {
      res.statusCode = 401;
      res.end(JSON.stringify({ ok: false, error: { code: "unauthorized", message: "no" } }));
      return;
    }
    res.end(JSON.stringify({ ok: true, result: { apiVersion: 1 } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  cleanups.push(
    () =>
      new Promise<void>((r) => {
        for (const res of open) res.destroy();
        server.close(() => r());
      }),
  );
  const tokenFile = join(dataDir, "run", "token");
  return {
    dataDir,
    goodToken,
    rpcAttempts: () => rpc,
    eventAttempts: () => sse,
    writeTokenFile: (t: string) => writeFileSync(tokenFile, t),
    readTokenFile: () => readToken(dataDir),
    /** ensureService/locate answer with `initialToken` first, the token file afterwards. */
    launcher: (initialToken: string) => ({
      ensureService: async () => ({ baseUrl, token: initialToken }),
      locate: async () => ({ baseUrl, token: readToken(dataDir) ?? "" }),
    }),
  };
}

/** A launcher that only attaches (never spawns): the service under test is in-process. */
function attachOnlyLauncher() {
  return createLauncher({
    extensionPath: "/nonexistent",
    allowPathNode: false,
    env: {},
    spawn: () => {
      throw new Error("must not spawn");
    },
  });
}

function connect(
  dataDir: string,
  over: Partial<ConstructorParameters<typeof ServiceConnection>[0]> = {},
) {
  const conn = new ServiceConnection({
    dataDir,
    launcher: attachOnlyLauncher(),
    backoff: { initialMs: 20, maxMs: 80 },
    ...over,
  });
  cleanups.push(() => conn.dispose());
  return conn;
}

function waitForState(conn: ServiceConnection, state: ConnectionState, timeoutMs = 3000) {
  return vi.waitFor(() => expect(conn.state).toBe(state), { timeout: timeoutMs, interval: 10 });
}

describe("ServiceConnection", () => {
  it("connects, proxies RPC and relays SSE events", async () => {
    const { dataDir, events } = await realService();
    const conn = connect(dataDir);
    const seen: ServerEvent[] = [];
    conn.onEvent((e) => seen.push(e));
    await conn.start();
    await waitForState(conn, "connected");

    const health = (await conn.call("health.get", {})) as { apiVersion: number };
    expect(health.apiVersion).toBe(1);

    events.publish({ type: "items.changed", entity: "commitment", ids: ["c1"] });
    await vi.waitFor(() => expect(seen).toHaveLength(1), { timeout: 2000, interval: 10 });
    expect(seen[0]).toEqual({ type: "items.changed", entity: "commitment", ids: ["c1"] });
  });

  it("an RPC 401 triggers one token re-read, then `unavailable` (no loop)", async () => {
    const fake = await fakeService();
    fake.writeTokenFile("b".repeat(43)); // wrong token on disk
    const readTokenSpy = vi.fn(() => fake.readTokenFile());
    const conn = connect(fake.dataDir, {
      launcher: fake.launcher("c".repeat(43)), // stale cached token
      readToken: readTokenSpy,
    });
    await conn.start();
    await waitForState(conn, "connected"); // this fake's /events doesn't check the token

    await expect(conn.call("health.get", {})).rejects.toMatchObject({ code: "unauthorized" });
    expect(readTokenSpy).toHaveBeenCalledTimes(1);
    expect(fake.rpcAttempts()).toBe(2); // the original call and one retry
    expect(conn.state).toBe("unavailable");

    // Further calls fail fast as `unavailable` (no re-read, no request) until a reconnect.
    await expect(conn.call("health.get", {})).rejects.toMatchObject({ code: "unavailable" });
    expect(readTokenSpy).toHaveBeenCalledTimes(1);
    expect(fake.rpcAttempts()).toBe(2);

    // The right token on disk + a reconnect recovers.
    fake.writeTokenFile(fake.goodToken);
    await conn.reconnect();
    await waitForState(conn, "connected");
    await expect(conn.call("health.get", {})).resolves.toMatchObject({ apiVersion: 1 });
  });

  it("an RPC 401 whose re-read token works retries transparently", async () => {
    const fake = await fakeService();
    fake.writeTokenFile(fake.goodToken);
    const conn = connect(fake.dataDir, { launcher: fake.launcher("c".repeat(43)) });
    await conn.start();
    await expect(conn.call("health.get", {})).resolves.toMatchObject({ apiVersion: 1 });
    expect(conn.state).toBe("connected");
  });

  it("an SSE 401 triggers one token re-read, then `unavailable` (no reconnect loop)", async () => {
    const fake = await fakeService({ authEvents: true });
    fake.writeTokenFile("b".repeat(43));
    const readTokenSpy = vi.fn(() => fake.readTokenFile());
    const conn = connect(fake.dataDir, {
      launcher: fake.launcher("c".repeat(43)),
      readToken: readTokenSpy,
    });
    await conn.start();
    await waitForState(conn, "unavailable");
    await new Promise((r) => setTimeout(r, 300)); // several backoff periods
    expect(readTokenSpy).toHaveBeenCalledTimes(1);
    expect(fake.eventAttempts()).toBe(2);
    expect(conn.state).toBe("unavailable");
  });

  it("killing the service shows `unavailable`; reconnect recovers", async () => {
    const svc1 = await realService();
    const conn = connect(svc1.dataDir);
    await conn.start();
    await waitForState(conn, "connected");

    await svc1.stop();
    await waitForState(conn, "unavailable");
    await expect(conn.call("health.get", {})).rejects.toBeInstanceOf(ApiError);

    // A new service in the same data dir (as a reconnect's ensureService would start).
    const svc2 = await startService({
      dataDir: svc1.dataDir,
      port: 0,
      secrets: createMemorySecretStore(),
      log: { info() {}, warn() {}, error() {} },
    });
    cleanups.push(() => svc2.stop());
    await conn.reconnect();
    await waitForState(conn, "connected");
    await expect(conn.call("health.get", {})).resolves.toMatchObject({ apiVersion: 1 });
  });

  it("the SSE loop re-attaches by itself once the service is back", async () => {
    const svc1 = await realService();
    const conn = connect(svc1.dataDir);
    await conn.start();
    await waitForState(conn, "connected");
    await svc1.stop();
    await waitForState(conn, "unavailable");
    const svc2 = await startService({
      dataDir: svc1.dataDir,
      port: 0,
      secrets: createMemorySecretStore(),
      log: { info() {}, warn() {}, error() {} },
    });
    cleanups.push(() => svc2.stop());
    await waitForState(conn, "connected");
  });

  it("ensureService failing leaves the connection `unavailable` with the error", async () => {
    const conn = connect("/nonexistent-data-dir", {
      launcher: {
        ensureService: () => Promise.reject(new Error("EM OS runtime not found")),
        locate: async () => null,
      },
    });
    await expect(conn.start()).rejects.toThrow(/runtime not found/);
    expect(conn.state).toBe("unavailable");
    await expect(conn.call("health.get", {})).rejects.toMatchObject({ code: "unavailable" });
  });

  it("reports state changes", async () => {
    const { dataDir } = await realService();
    const conn = connect(dataDir);
    const states: ConnectionState[] = [];
    conn.onStateChange((s) => states.push(s));
    expect(conn.state).toBe("connecting"); // before start, as the webview assumes
    await conn.start();
    await waitForState(conn, "connected");
    await conn.reconnect();
    await waitForState(conn, "connected");
    expect(states).toEqual(["connected", "connecting", "connected"]);
  });
});

describe("createSseParser", () => {
  it("parses data lines, ignores comments, joins multi-line data, handles CRLF and splits", () => {
    const out: string[] = [];
    const feed = createSseParser((d) => out.push(d));
    feed(": connected\n\n");
    feed('data: {"a":1}\n\nda');
    feed('ta: {"b":\r\ndata: 2}\r\n\r\n');
    feed("event: x\ndata:3\n\n");
    expect(out).toEqual(['{"a":1}', '{"b":\n2}', "3"]);
  });
});
