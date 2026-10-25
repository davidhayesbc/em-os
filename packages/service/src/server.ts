// The loopback HTTP server (node:http, no framework) and the service lifecycle.
//
// Request pipeline: Host check (403) → GET /health/ping (no auth) → bearer (401) →
// X-EMOS-API (409) → route: POST /rpc/:op | GET /events | 404. No CORS headers, ever.
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { API_VERSION } from "@emos/api-contract";
import { type Clock, type LogFields, type Logger, type SecretStore, systemClock } from "@emos/core";
import { assertNotInGitCheckout, dataLayout, toDbInstant } from "@emos/store-sqlite";
import {
  isAllowedHost,
  loadOrCreateToken,
  parseBearer,
  tokensEqual,
  writeTokenFile,
} from "./auth.js";
import {
  DEFAULT_PORT,
  HEARTBEAT_MS,
  MAX_BODY_BYTES,
  readServiceVersion,
  runtimePaths,
  type ServiceConfig,
  type ServiceInfo,
} from "./config.js";
import { createContext, type ServiceContext } from "./context.js";
import { createEventBus, type EventBus, serveEvents } from "./events.js";
import { acquireLock, type Lock } from "./lockfile.js";
import { dispatchRpc, errorResult, type RpcResult } from "./rpc.js";
import {
  createKeychainSecretStore,
  createMemorySecretStore,
  isMemorySecretStore,
  secretStoreKind,
} from "./secrets.js";

const POSIX = process.platform !== "win32";
const LOOPBACK = "127.0.0.1";
const RPC_PATH = /^\/rpc\/([A-Za-z0-9._-]{1,128})$/;

export interface StartServiceOptions {
  dataDir: string;
  /** Preferred port (default 47821). If it is in use, an ephemeral port is used. 0 = ephemeral. */
  port?: number;
  /**
   * Default: the OS keychain (service name `em-os`), or the in-memory store when the test-only
   * `EMOS_SECRET_STORE=memory` is set and `EMOS_DATA_DIR` names this (non-default) data dir
   * (see `secretStoreKind`). `health.get` reports which kind is in use.
   */
  secrets?: SecretStore;
  clock?: Clock;
  /** Default: one line per event on stderr (event name + ids/counts). */
  log?: Logger;
  /** Default: a fresh in-process bus. Injectable so tests (and later tasks) can publish. */
  events?: EventBus;
  /** SSE heartbeat interval (default 25 s). */
  heartbeatMs?: number;
  /**
   * Called after a `service.shutdown` request has stopped the service (main.ts exits). Not
   * called for `stop()` by the owner.
   */
  onShutdown?: () => void;
}

export interface RunningService {
  port: number;
  /** The bound address; always 127.0.0.1. */
  host: string;
  token: string;
  stop(): Promise<void>;
}

/** Minimal stderr logger: `<iso> <level> <event> k=v…`. Fields are ids and counts only. */
export function createStderrLogger(clock: Clock = systemClock): Logger {
  const line = (level: string) => (event: string, fields?: LogFields) => {
    const kv = Object.entries(fields ?? {})
      .map(([k, v]) => ` ${k}=${JSON.stringify(v)}`)
      .join("");
    process.stderr.write(`${clock.now().toISOString()} ${level} ${event}${kv}\n`);
  };
  return { info: line("info"), warn: line("warn"), error: line("error") };
}

function sendJson(res: ServerResponse, { status, body }: RpcResult, extra = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(text);
}

class BodyTooLarge extends Error {}

/** Reads the body as UTF-8, draining before rejecting when it exceeds `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers["content-length"]);
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    let tooLarge = Number.isFinite(declared) && declared > limit;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        return;
      }
      if (!tooLarge) chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      if (tooLarge) reject(new BodyTooLarge());
      else resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

function createRequestListener(
  ctx: ServiceContext,
  token: string,
  getPort: () => number,
  streams: Set<() => void>,
  afterRpc: (res: ServerResponse) => void,
) {
  const { config, log } = ctx;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isAllowedHost(req.headers.host, getPort())) {
      log.warn("http.forbidden_host");
      sendJson(res, errorResult("unauthorized", "Host not allowed", 403));
      return;
    }
    const path = (req.url ?? "/").split("?")[0] ?? "/";

    if (req.method === "GET" && path === "/health/ping") {
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": 2,
        "Cache-Control": "no-store",
      });
      res.end("ok");
      return;
    }

    const presented = parseBearer(req.headers.authorization);
    if (presented === null || !tokensEqual(token, presented)) {
      log.warn("http.unauthorized");
      sendJson(res, errorResult("unauthorized", "Missing or invalid bearer token"), {
        "WWW-Authenticate": "Bearer",
      });
      return;
    }

    if (req.headers["x-emos-api"] !== String(API_VERSION)) {
      sendJson(
        res,
        errorResult("incompatible_version", `This service speaks X-EMOS-API ${API_VERSION}`),
      );
      return;
    }

    if (req.method === "GET" && path === "/events") {
      const end = serveEvents(req, res, ctx.events, config.heartbeatMs);
      streams.add(end);
      res.on("close", () => streams.delete(end));
      return;
    }

    const m = RPC_PATH.exec(path);
    if (req.method !== "POST" || !m?.[1]) {
      sendJson(res, errorResult("not_found", "No such route"));
      return;
    }
    const opName = m[1];

    let body: string;
    try {
      body = await readBody(req, config.maxBodyBytes);
    } catch (e) {
      if (e instanceof BodyTooLarge) {
        log.warn("rpc.body_too_large");
        sendJson(
          res,
          errorResult("invalid_input", `Request body exceeds ${config.maxBodyBytes} bytes`, 413),
        );
      } else {
        req.destroy();
      }
      return;
    }

    const started = performance.now();
    const result = await dispatchRpc(ctx, opName, body, {});
    const ms = Math.round(performance.now() - started);
    if (result.body.ok) {
      log.info("rpc", { op: opName, status: result.status, ms });
    } else if (result.body.error.code === "not_found") {
      log.warn("rpc.failed", { status: result.status, code: result.body.error.code });
    } else {
      log.warn("rpc.failed", { op: opName, status: result.status, code: result.body.error.code });
    }
    sendJson(res, result);
    afterRpc(res);
  };

  return (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch((e: unknown) => {
      log.error("http.request_failed", { errorName: e instanceof Error ? e.name : typeof e });
      if (!res.headersSent) sendJson(res, errorResult("internal", "Internal error"));
      else res.destroy();
    });
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolveListen, reject) => {
    const onError = (e: Error) => {
      server.off("listening", onListening);
      reject(e);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      if (addr === null || typeof addr === "string") reject(new Error("No server address"));
      else resolveListen(addr.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port, host: LOOPBACK, exclusive: true });
  });
}

/** Preferred port first; if it is taken (or reserved, on Windows), any free port. */
async function listenWithFallback(server: Server, preferred: number, log: Logger): Promise<number> {
  try {
    return await listen(server, preferred);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (preferred === 0 || (code !== "EADDRINUSE" && code !== "EACCES")) throw e;
    log.warn("service.port_unavailable", { port: preferred, code: code ?? "unknown" });
    return listen(server, 0);
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
}

function defaultSecretStore(log: Logger, dataDir: string): SecretStore {
  const { kind, ignored } = secretStoreKind(process.env, { dataDir });
  if (ignored) log.warn("service.secret_store_override_ignored");
  if (kind === "memory") {
    log.warn("service.secret_store_memory");
    return createMemorySecretStore();
  }
  return createKeychainSecretStore();
}

/**
 * Starts the service on 127.0.0.1: checks the data dir, takes the single-instance lock, opens
 * and migrates the database, loads (or creates) the token, listens, then writes
 * `run/token` and `run/service.json`. Rejects with "already running" if another live instance
 * holds the lock.
 */
export async function startService(opts: StartServiceOptions): Promise<RunningService> {
  const clock = opts.clock ?? systemClock;
  const log = opts.log ?? createStderrLogger(clock);
  const events = opts.events ?? createEventBus(log);

  // Refuse a checkout before creating anything in it; re-check the real path afterwards so a
  // symlink into a checkout is caught too.
  const requested = resolve(opts.dataDir);
  assertNotInGitCheckout(requested, existsSync);
  mkdirSync(requested, { recursive: true, ...(POSIX ? { mode: 0o700 } : {}) });
  const dataDir = realpathSync(requested);
  assertNotInGitCheckout(dataDir, existsSync);
  const secrets = opts.secrets ?? defaultSecretStore(log, dataDir);

  const paths = runtimePaths(dataDir);
  mkdirSync(paths.runDir, { recursive: true, ...(POSIX ? { mode: 0o700 } : {}) });

  const lock: Lock = await acquireLock(paths.lock);
  let ctx: ServiceContext | undefined;
  let server: Server | undefined;
  const streams = new Set<() => void>();
  try {
    const config: ServiceConfig = {
      dataDir,
      layout: dataLayout(dataDir),
      serviceVersion: readServiceVersion(),
      startedAt: toDbInstant(clock.now()),
      heartbeatMs: opts.heartbeatMs ?? HEARTBEAT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
      secretStore: isMemorySecretStore(secrets) ? "memory" : "keychain",
    };
    let shutdown: (() => void) | undefined;
    let shutdownRequested = false;
    const context = createContext({
      config,
      clock,
      log,
      secrets,
      events,
      requestShutdown: () => {
        shutdownRequested = true;
      },
    });
    ctx = context;
    const token = await loadOrCreateToken(secrets);

    let port = 0;
    const srv = createServer(
      createRequestListener(
        context,
        token,
        () => port,
        streams,
        (res) => {
          // The handler asked to stop: do it once this response is on the wire.
          if (!shutdownRequested) return;
          res.on("close", () => shutdown?.());
        },
      ),
    );
    server = srv;
    srv.on("clientError", (_err, socket) => socket.destroy());
    port = await listenWithFallback(srv, opts.port ?? DEFAULT_PORT, log);

    writeTokenFile(paths.token, token);
    const info: ServiceInfo = {
      pid: process.pid,
      port,
      apiVersion: API_VERSION,
      serviceVersion: config.serviceVersion,
      startedAt: config.startedAt,
    };
    writeJsonAtomic(paths.serviceJson, info);
    log.info("service.started", { pid: process.pid, port });

    let stopping: Promise<void> | undefined;
    const stop = (): Promise<void> => {
      stopping ??= (async () => {
        for (const end of [...streams]) end();
        await new Promise<void>((r) => {
          srv.close(() => r());
          srv.closeAllConnections();
        });
        context.db.close();
        rmSync(paths.serviceJson, { force: true });
        lock.release();
        log.info("service.stopped", { pid: process.pid });
      })();
      return stopping;
    };
    shutdown = () => {
      log.info("service.shutdown_requested");
      stop().then(
        () => opts.onShutdown?.(),
        (e: unknown) => {
          log.error("service.shutdown_failed", {
            errorName: e instanceof Error ? e.name : typeof e,
          });
          opts.onShutdown?.();
        },
      );
    };
    const addr = srv.address();
    const host = addr !== null && typeof addr !== "string" ? addr.address : LOOPBACK;
    return { port, host, token, stop };
  } catch (e) {
    for (const end of [...streams]) end();
    if (server?.listening) {
      const s = server;
      await new Promise<void>((r) => {
        s.close(() => r());
        s.closeAllConnections();
      });
    }
    ctx?.db.close();
    lock.release();
    log.error("service.start_failed", { errorName: e instanceof Error ? e.name : typeof e });
    throw e;
  }
}
