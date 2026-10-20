// Finds the local EM OS service, or starts it: read `run/service.json`, check the pid and
// `GET /health/ping`, else spawn the service detached (cwd = data dir, output appended to
// `<dataDir>/logs/service.log`) and poll until it answers. A failed start quotes the log tail.
//
// Version-aware attach: a located service is asked `health.get`; if its `serviceVersion` or
// `apiVersion` differs from this extension's, it is asked to stop (`service.shutdown`), given up
// to 5 s to release its lock (then killed), and a matching service is spawned.
//
// Runtime (Ruling R14): EMOS_NODE_PATH -> the bundled `<extensionPath>/dist/runtime/node`
// (`node.exe` on Windows) -> `node` on PATH in Development/Test mode only. Never VS Code's own
// `process.execPath`: native addons fail macOS library validation under the main Code binary.
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { closeSync, existsSync } from "node:fs";
import { join } from "node:path";
import { API_VERSION, ApiError, createClient, httpTransport } from "@emos/api-contract";
import {
  assertNotInGitCheckout,
  baseUrl,
  isPidAlive,
  ping,
  readLockPid,
  readServiceInfo,
  readToken,
  resolveServiceEntry,
} from "./runtime.js";
import { openServiceLog, withLogTail } from "./service-log.js";

/** Where the service is and how to authenticate. Stays in the extension host. */
export interface ServiceEndpoint {
  baseUrl: string;
  token: string;
}

/** How the service is spawned: working directory and the log fd for stdout/stderr. */
export interface ServiceSpawnOptions {
  /** The data dir (a cwd outside any user folder: Windows locks a process's cwd). */
  cwd: string;
  /** Append-mode fd of `logs/service.log`; the child gets it as stdout and stderr. */
  logFd: number;
}

/** A spawned service process: `exitCode()` is null while it runs. */
export interface SpawnedChild {
  pid: number | undefined;
  exitCode(): number | null;
}

export interface LauncherOptions {
  extensionPath: string;
  /** True in `ExtensionMode.Development`/`Test`: allows falling back to `node` on PATH. */
  allowPathNode: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  /** Starts `command args…` detached. Default: {@link spawnDetached}. */
  spawn?: (command: string, args: string[], opts: ServiceSpawnOptions) => SpawnedChild;
  isAlive?: (pid: number) => boolean;
  ping?: (port: number) => Promise<boolean>;
  /** How long a spawned service gets to answer the ping (default 10 s). */
  startTimeoutMs?: number;
  pollMs?: number;
  /**
   * The service version this extension ships with (default: the build-time `__EMOS_VERSION__`,
   * the extension's own version). A running service reporting anything else is replaced.
   */
  expectedServiceVersion?: string;
  /** `health.get` on a located service: its versions, `"incompatible"` (409), or null (failed). */
  health?: (ep: ServiceEndpoint) => Promise<HealthVersions | "incompatible" | null>;
  /** `service.shutdown`; resolves true if the service accepted. */
  shutdown?: (ep: ServiceEndpoint) => Promise<boolean>;
  /** Last resort when a replaced service doesn't release its lock. Default `process.kill`. */
  kill?: (pid: number) => void;
  /** How long a replaced service gets to release the lock before it is killed (default 5 s). */
  stopTimeoutMs?: number;
}

export interface HealthVersions {
  serviceVersion: string;
  apiVersion: number;
}

declare const __EMOS_VERSION__: string | undefined;

/** The extension's version, injected by build.mjs; `0.0.0-dev` for unbundled source (tests). */
export const EXTENSION_VERSION: string =
  typeof __EMOS_VERSION__ === "string" ? __EMOS_VERSION__ : "0.0.0-dev";

function rpcClient(ep: ServiceEndpoint) {
  const fetchWithTimeout: typeof fetch = (url, init) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
  return createClient({ transport: httpTransport(ep.baseUrl, fetchWithTimeout), token: ep.token });
}

async function defaultHealth(ep: ServiceEndpoint): Promise<HealthVersions | "incompatible" | null> {
  try {
    const h = await rpcClient(ep).call("health.get", {});
    return { serviceVersion: h.serviceVersion, apiVersion: h.apiVersion };
  } catch (e) {
    return e instanceof ApiError && e.code === "incompatible_version" ? "incompatible" : null;
  }
}

async function defaultShutdown(ep: ServiceEndpoint): Promise<boolean> {
  try {
    return (await rpcClient(ep).call("service.shutdown", {})).ok === true;
  } catch {
    return false;
  }
}

export interface Launcher {
  /** Attach to the running service, starting it first if needed. Concurrent calls share one attempt. */
  ensureService(dataDir: string): Promise<ServiceEndpoint>;
  /** Attach only: the running service's endpoint, or null if none answers. Never spawns. */
  locate(dataDir: string): Promise<ServiceEndpoint | null>;
  /** The Node binary the service would be started with. Throws if there is none. */
  resolveNode(): string;
  /** The service entry script. Throws if there is none. */
  resolveServiceEntry(): string;
}

export class RuntimeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeNotFoundError";
  }
}

/**
 * Detached, no shell, unref'd. stdout/stderr go to the log file's fd, never a pipe (a pipe
 * would break once this window closes); stdin is ignored.
 */
export function spawnDetached(
  command: string,
  args: string[],
  opts: ServiceSpawnOptions,
  spawnImpl: typeof nodeSpawn = nodeSpawn,
): SpawnedChild {
  let exit: number | null = null;
  const child: ChildProcess = spawnImpl(command, args, {
    cwd: opts.cwd,
    detached: true,
    shell: false,
    stdio: ["ignore", opts.logFd, opts.logFd],
    windowsHide: true,
  });
  child.on("exit", (code) => {
    exit = code ?? -1;
  });
  child.on("error", () => {
    exit = -1;
  });
  child.unref();
  return { pid: child.pid, exitCode: () => exit };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createLauncher(opts: LauncherOptions): Launcher {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? existsSync;
  const spawn = opts.spawn ?? ((command, args, o) => spawnDetached(command, args, o));
  const isAlive = opts.isAlive ?? isPidAlive;
  const pingPort = opts.ping ?? ((port: number) => ping(port));
  const startTimeoutMs = opts.startTimeoutMs ?? 10_000;
  const pollMs = opts.pollMs ?? 100;
  const expectedVersion = opts.expectedServiceVersion ?? EXTENSION_VERSION;
  const health = opts.health ?? defaultHealth;
  const shutdown = opts.shutdown ?? defaultShutdown;
  const kill = opts.kill ?? ((pid: number) => process.kill(pid));
  const stopTimeoutMs = opts.stopTimeoutMs ?? 5_000;
  const inflight = new Map<string, Promise<ServiceEndpoint>>();

  function resolveNode(): string {
    const override = env.EMOS_NODE_PATH;
    if (override) {
      if (!exists(override)) {
        throw new RuntimeNotFoundError(`EMOS_NODE_PATH points to a missing file: ${override}`);
      }
      return override;
    }
    const bundled = join(
      opts.extensionPath,
      "dist",
      "runtime",
      platform === "win32" ? "node.exe" : "node",
    );
    if (exists(bundled)) return bundled;
    if (opts.allowPathNode) return "node";
    throw new RuntimeNotFoundError(
      "EM OS runtime not found: reinstall the extension or set EMOS_NODE_PATH to a Node 24 binary",
    );
  }

  async function locateWithPid(
    dataDir: string,
  ): Promise<{ ep: ServiceEndpoint; pid: number } | null> {
    const info = readServiceInfo(dataDir);
    if (info === null || info === "invalid") return null;
    if (!isAlive(info.pid)) return null;
    if (!(await pingPort(info.port))) return null;
    const token = readToken(dataDir);
    if (token === null) return null; // between ping and token write? treat as not ready yet
    return { ep: { baseUrl: baseUrl(info.port), token }, pid: info.pid };
  }

  async function locate(dataDir: string): Promise<ServiceEndpoint | null> {
    return (await locateWithPid(dataDir))?.ep ?? null;
  }

  /** True when the located service speaks another API or is another build than ours. */
  async function isMismatched(ep: ServiceEndpoint): Promise<boolean> {
    const h = await health(ep);
    if (h === null) return false; // can't tell (transient failure): attach as before
    if (h === "incompatible") return true;
    return h.apiVersion !== API_VERSION || h.serviceVersion !== expectedVersion;
  }

  /** The lock is gone, or its owner is dead. */
  function lockReleased(dataDir: string): boolean {
    const owner = readLockPid(dataDir);
    return owner === null || !isAlive(owner);
  }

  async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
    const deadline = performance.now() + ms;
    while (!cond()) {
      if (performance.now() >= deadline) return false;
      await sleep(pollMs);
    }
    return true;
  }

  /** Stops a mismatched service: `service.shutdown`, wait for the lock, else kill its pid. */
  async function replace(dataDir: string, old: { ep: ServiceEndpoint; pid: number }) {
    const accepted = await shutdown(old.ep);
    if (accepted && (await waitFor(() => lockReleased(dataDir), stopTimeoutMs))) return;
    try {
      kill(old.pid);
    } catch {
      // already gone
    }
    await waitFor(() => !isAlive(old.pid), stopTimeoutMs);
  }

  /** "Already running": the lock belongs to a live process other than our child. */
  function anotherInstanceHoldsLock(dataDir: string, childPid: number | undefined): boolean {
    const owner = readLockPid(dataDir);
    return owner !== null && owner !== childPid && isAlive(owner);
  }

  async function start(dataDir: string): Promise<ServiceEndpoint> {
    const found = await locateWithPid(dataDir);
    if (found && !(await isMismatched(found.ep))) return found.ep;

    // Resolve everything needed to start a new service before stopping a mismatched one.
    assertNotInGitCheckout(dataDir, exists);
    const node = resolveNode();
    const entry = resolveServiceEntry(opts.extensionPath, exists);
    let replacedPid: number | undefined;
    if (found) {
      await replace(dataDir, found);
      replacedPid = found.pid;
    }
    const log = openServiceLog(dataDir);
    let child: SpawnedChild;
    try {
      child = spawn(node, [entry, "--data-dir", dataDir], { cwd: dataDir, logFd: log.fd });
    } finally {
      closeSync(log.fd); // the child has its own copy
    }

    const deadline = performance.now() + startTimeoutMs;
    for (;;) {
      const now = await locateWithPid(dataDir);
      if (now && now.pid !== replacedPid) return now.ep;
      const code = child.exitCode();
      // Exit 1 with the lock held by someone else = lost a start race with another window:
      // keep waiting for the winner to publish service.json.
      if (code !== null && !anotherInstanceHoldsLock(dataDir, child.pid)) {
        throw new Error(
          withLogTail(`EM OS service exited (code ${code}) before it became ready`, log),
        );
      }
      if (performance.now() >= deadline) {
        throw new Error(
          withLogTail(`EM OS service did not become ready within ${startTimeoutMs / 1000}s`, log),
        );
      }
      await sleep(pollMs);
    }
  }

  return {
    ensureService(dataDir) {
      const current = inflight.get(dataDir);
      if (current) return current;
      const attempt = start(dataDir).finally(() => inflight.delete(dataDir));
      inflight.set(dataDir, attempt);
      return attempt;
    },
    locate,
    resolveNode,
    resolveServiceEntry: () => resolveServiceEntry(opts.extensionPath, exists),
  };
}
