// Test-only helpers: real services on ephemeral ports in temp data dirs under os.tmpdir(),
// never inside the repo. Call `cleanup()` in afterEach.
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_VERSION } from "@emos/api-contract";
import { type LogFields, type Logger, nullLogger } from "@emos/core";
import { createMemorySecretStore } from "./secrets.js";
import { type StartServiceOptions, startService } from "./server.js";

const dirs: string[] = [];
const running: Array<{ stop(): Promise<void> }> = [];

/** A fresh temp dir (with a space and Unicode in its name, to exercise odd paths). */
export function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "emos service zoë-"));
  dirs.push(dir);
  return dir;
}

export type TestService = Awaited<ReturnType<typeof startService>> & { dataDir: string };

/** Starts a service on an ephemeral port with an in-memory secret store and a silent logger. */
export async function startTestService(
  opts: Partial<StartServiceOptions> = {},
): Promise<TestService> {
  const dataDir = opts.dataDir ?? tmpDir();
  const svc = await startService({
    port: 0,
    secrets: createMemorySecretStore(),
    log: nullLogger,
    ...opts,
    dataDir,
  });
  running.push(svc);
  return { ...svc, dataDir };
}

export async function cleanup(): Promise<void> {
  for (const s of running.splice(0)) await s.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: unknown;
}

/**
 * A raw HTTP request via node:http (fetch can't override `Host`). Defaults to
 * `Host: 127.0.0.1:<port>`.
 */
export function request(
  port: number,
  opts: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
    /** Send the body with chunked encoding instead of Content-Length. */
    chunked?: boolean;
  },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: `127.0.0.1:${port}`, ...opts.headers };
    if (opts.body !== undefined && !opts.chunked) {
      headers["content-length"] = String(Buffer.byteLength(opts.body));
    }
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: opts.method ?? "POST",
        path: opts.path,
        headers,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/** Headers a first-party client sends. */
export function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-emos-api": String(API_VERSION),
    "content-type": "application/json",
  };
}

/** A logger that records every call, for "never logs X" assertions. */
export function spyLogger(): Logger & {
  calls: Array<{ level: string; event: string; fields?: LogFields }>;
} {
  const calls: Array<{ level: string; event: string; fields?: LogFields }> = [];
  const rec =
    (level: string) =>
    (event: string, fields?: LogFields): void => {
      calls.push({ level, event, ...(fields ? { fields } : {}) });
    };
  return { calls, info: rec("info"), warn: rec("warn"), error: rec("error") };
}
