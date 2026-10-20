// The extension's one link to the service: the typed RPC client, the `GET /events` SSE stream
// and the connection state the webviews show. Holds the token; nothing here reaches a webview.
//
// - RPC 401: re-read `run/token` once and retry; still 401 -> `unavailable` and further calls
//   fail fast until `reconnect()` (no loop).
// - SSE: `fetch` streaming with both headers; `data:` lines are ServerEvents. A dropped stream
//   sets `unavailable` and retries with backoff (1 s doubling to 30 s), re-reading
//   `service.json` each time (the service may be back on another port). An SSE 401 gets the
//   same single token re-read, then stops retrying.
import {
  API_VERSION,
  ApiError,
  createClient,
  httpTransport,
  type OpInput,
  type OpName,
  ServerEvent,
} from "@emos/api-contract";
import type { Launcher, ServiceEndpoint } from "./launcher.js";
import { readToken } from "./runtime.js";

export type ConnectionState = "connecting" | "connected" | "unavailable";

export interface Disposable {
  dispose(): void;
}

export interface ConnectionOptions {
  dataDir: string;
  launcher: Pick<Launcher, "ensureService" | "locate">;
  /** Re-reads the token file. Default: `run/token` in `dataDir`. */
  readToken?: () => string | null;
  fetch?: typeof fetch;
  backoff?: { initialMs: number; maxMs: number };
}

type StreamOutcome = "unauthorized" | "closed" | "failed";

/**
 * Incremental `text/event-stream` parser: feed it decoded text chunks; it calls `onData` with
 * each event's data (multi-line data joined with `\n`). Comments and other fields are ignored.
 */
export function createSseParser(onData: (data: string) => void): (chunk: string) => void {
  let buffer = "";
  let data: string[] = [];
  return (chunk) => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.search(/\r\n|\r|\n/);
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + (buffer.startsWith("\r\n", nl) ? 2 : 1));
      if (line === "") {
        if (data.length > 0) onData(data.join("\n"));
        data = [];
      } else if (line.startsWith("data:")) {
        data.push(line.slice(line.startsWith("data: ") ? 6 : 5));
      }
    }
  };
}

export class ServiceConnection {
  private readonly opts: ConnectionOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly rereadToken: () => string | null;
  private _state: ConnectionState = "connecting";
  private endpoint: ServiceEndpoint | null = null;
  private starting: Promise<void> | null = null;
  /** Bumped by start()/dispose(); stale async work checks it and bails out. */
  private generation = 0;
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeRetry: (() => void) | null = null;
  private disposed = false;
  private readonly stateFns = new Set<(s: ConnectionState) => void>();
  private readonly eventFns = new Set<(e: ServerEvent) => void>();

  constructor(opts: ConnectionOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetch ?? fetch;
    this.rereadToken = opts.readToken ?? (() => readToken(opts.dataDir));
  }

  get state(): ConnectionState {
    return this._state;
  }

  onStateChange(fn: (s: ConnectionState) => void): Disposable {
    this.stateFns.add(fn);
    return { dispose: () => this.stateFns.delete(fn) };
  }

  onEvent(fn: (e: ServerEvent) => void): Disposable {
    this.eventFns.add(fn);
    return { dispose: () => this.eventFns.delete(fn) };
  }

  /** (Re)connect: ensure the service runs (starting it if needed), then open the event stream. */
  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("connection disposed"));
    const gen = this.reset();
    this.setState("connecting");
    const attempt = (async () => {
      try {
        const ep = await this.opts.launcher.ensureService(this.opts.dataDir);
        if (gen !== this.generation) return;
        this.endpoint = ep;
        void this.runEvents(gen);
      } catch (e) {
        if (gen === this.generation) {
          this.endpoint = null;
          this.setState("unavailable");
        }
        throw e;
      }
    })();
    this.starting = attempt;
    return attempt;
  }

  /** `emos.reconnect`: same as start — re-run ensureService and re-open the stream. */
  reconnect(): Promise<void> {
    return this.start();
  }

  /** Calls an op on the service. Rejects with ApiError (`unavailable` when not connected). */
  async call(op: string, input: unknown): Promise<unknown> {
    if (this.starting) await this.starting.catch(() => undefined);
    const ep = this.endpoint;
    if (!ep) throw new ApiError("unavailable", "EM OS service unavailable");
    try {
      return await this.callWith(ep.baseUrl, ep.token, op, input);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "unauthorized") throw e;
    }
    // 401: the service may have restarted with a new token. Re-read once and retry.
    const fresh = this.rereadToken();
    if (fresh !== null) {
      try {
        const result = await this.callWith(ep.baseUrl, fresh, op, input);
        if (this.endpoint === ep) ep.token = fresh;
        return result;
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "unauthorized") throw e;
      }
    }
    this.markUnauthorized(ep);
    throw new ApiError("unauthorized", "EM OS rejected the token; run EM OS: Reconnect");
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
    this.stateFns.clear();
    this.eventFns.clear();
  }

  private callWith(base: string, token: string, op: string, input: unknown): Promise<unknown> {
    const client = createClient({ transport: httpTransport(base, this.fetchImpl), token });
    return client.call(op as OpName, input as OpInput<OpName>);
  }

  /** Persistent 401: stop everything until an explicit reconnect. */
  private markUnauthorized(ep: ServiceEndpoint): void {
    if (this.endpoint !== ep) return;
    this.reset();
    this.endpoint = null;
    this.setState("unavailable");
  }

  /** Cancels the stream and any pending retry; returns the new generation. */
  private reset(): number {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.wakeRetry?.();
    this.wakeRetry = null;
    return this.generation;
  }

  private setState(s: ConnectionState): void {
    if (this._state === s) return;
    this._state = s;
    for (const fn of [...this.stateFns]) fn(s);
  }

  private async runEvents(gen: number): Promise<void> {
    const { initialMs, maxMs } = this.opts.backoff ?? { initialMs: 1000, maxMs: 30_000 };
    let delay = initialMs;
    let tokenRetried = false;
    while (gen === this.generation) {
      const ep = this.endpoint;
      if (!ep) return;
      const outcome = await this.streamOnce(ep, gen, () => {
        delay = initialMs; // a connection that opened resets the backoff
        tokenRetried = false;
      });
      if (gen !== this.generation) return;

      if (outcome === "unauthorized") {
        const fresh = tokenRetried ? null : this.rereadToken();
        tokenRetried = true;
        if (fresh !== null) {
          ep.token = fresh;
          continue;
        }
        this.markUnauthorized(ep);
        return;
      }

      this.setState("unavailable");
      await this.sleep(delay, gen);
      if (gen !== this.generation) return;
      delay = Math.min(delay * 2, maxMs);
      // The service may have been restarted (e.g. by another window) on a different port.
      const found = await this.opts.launcher.locate(this.opts.dataDir).catch(() => null);
      if (gen !== this.generation) return;
      if (found) this.endpoint = found;
    }
  }

  private sleep(ms: number, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (gen !== this.generation) return resolve();
      this.wakeRetry = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.wakeRetry = null;
        resolve();
      }, ms);
    });
  }

  private async streamOnce(
    ep: ServiceEndpoint,
    gen: number,
    onOpen: () => void,
  ): Promise<StreamOutcome> {
    const abort = new AbortController();
    this.abort = abort;
    try {
      const res = await this.fetchImpl(`${ep.baseUrl.replace(/\/+$/, "")}/events`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${ep.token}`,
          "X-EMOS-API": String(API_VERSION),
        },
        signal: abort.signal,
      });
      if (res.status === 401) {
        await res.body?.cancel().catch(() => undefined);
        return "unauthorized";
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        return "failed";
      }
      if (gen !== this.generation) return "closed";
      onOpen();
      this.setState("connected");

      const feed = createSseParser((data) => this.dispatch(data));
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return "closed";
        if (gen !== this.generation) return "closed";
        feed(decoder.decode(value, { stream: true }));
      }
    } catch {
      return "failed";
    } finally {
      if (this.abort === abort) this.abort = null;
      abort.abort();
    }
  }

  private dispatch(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = ServerEvent.safeParse(json);
    if (!parsed.success) return;
    for (const fn of [...this.eventFns]) fn(parsed.data);
  }
}
