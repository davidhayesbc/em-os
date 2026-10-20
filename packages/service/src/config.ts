import { join } from "node:path";
import { parseArgs as parseCliArgs } from "node:util";
import { type DataLayout, dataLayout, resolveDataDir } from "@emos/store-sqlite";

/** Preferred loopback port. If it is taken the service falls back to an ephemeral port. */
export const DEFAULT_PORT = 47821;
/** Largest accepted RPC request body. */
export const MAX_BODY_BYTES = 1024 * 1024;
/** SSE comment heartbeat interval. */
export const HEARTBEAT_MS = 25_000;

export interface ServiceConfig {
  /** Real path of the data directory (symlinks resolved). */
  dataDir: string;
  layout: DataLayout;
  serviceVersion: string;
  /** Canonical instant (`toDbInstant`) at which this instance started. */
  startedAt: string;
  heartbeatMs: number;
  maxBodyBytes: number;
  /** `memory` only for the test-only `EMOS_SECRET_STORE=memory` switch (or an injected one). */
  secretStore: "keychain" | "memory";
}

/** Contents of `run/service.json`. Clients read it to find the port; it holds no secrets. */
export interface ServiceInfo {
  pid: number;
  port: number;
  apiVersion: number;
  serviceVersion: string;
  startedAt: string;
}

export interface RuntimePaths {
  runDir: string;
  /** `run/service.json` — {@link ServiceInfo}. Present only while the service runs. */
  serviceJson: string;
  /** `run/token` — the first-party bearer token, mode 0o600. */
  token: string;
  /** `run/service.lock` — the pid of the running instance. */
  lock: string;
}

export function runtimePaths(dataDir: string): RuntimePaths {
  const { runDir } = dataLayout(dataDir);
  return {
    runDir,
    serviceJson: join(runDir, "service.json"),
    token: join(runDir, "token"),
    lock: join(runDir, "service.lock"),
  };
}

/**
 * Injected at build time by esbuild `define` (never read from a package.json at runtime, which
 * a bundle can't locate): scripts/build.mjs uses this package's version; the packaged VSIX
 * re-bundles the service with the extension's version, so the two always match there.
 */
declare const __EMOS_VERSION__: string | undefined;

/** The build-time version, or `0.0.0-dev` when running unbundled source (tests). */
export function readServiceVersion(): string {
  return typeof __EMOS_VERSION__ === "string" ? __EMOS_VERSION__ : "0.0.0-dev";
}

/**
 * `main.ts` arguments: `--data-dir <path>` (default: the platform data dir, see
 * `resolveDataDir`) and `--port <0-65535>` (default {@link DEFAULT_PORT}; 0 = ephemeral).
 * Throws on unknown options or a bad port.
 */
export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homedir: string,
): { dataDir: string; port: number } {
  const { values } = parseCliArgs({
    args: argv,
    options: { "data-dir": { type: "string" }, port: { type: "string" } },
    strict: true,
    allowPositionals: false,
  });
  const dataDir = values["data-dir"] || resolveDataDir(env, platform, homedir);
  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    if (!/^\d{1,5}$/.test(values.port) || Number(values.port) > 65535) {
      throw new Error(`Invalid --port: ${values.port} (expected 0-65535)`);
    }
    port = Number(values.port);
  }
  return { dataDir, port };
}
