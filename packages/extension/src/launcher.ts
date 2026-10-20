// Finds the local EM OS service, or starts it: read `run/service.json`, check the pid and
// `GET /health/ping`, else spawn the service detached and poll until it answers.
//
// Runtime (Ruling R14): EMOS_NODE_PATH -> the bundled `<extensionPath>/dist/runtime/node`
// (`node.exe` on Windows) -> `node` on PATH in Development/Test mode only. Never VS Code's own
// `process.execPath`: native addons fail macOS library validation under the main Code binary.
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

/** Where the service is and how to authenticate. Stays in the extension host. */
export interface ServiceEndpoint {
  baseUrl: string;
  token: string;
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
  spawn?: (command: string, args: string[]) => SpawnedChild;
  isAlive?: (pid: number) => boolean;
  ping?: (port: number) => Promise<boolean>;
  /** How long a spawned service gets to answer the ping (default 10 s). */
  startTimeoutMs?: number;
  pollMs?: number;
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

/** Detached, no shell, no stdio (a pipe would break once this window closes), unref'd. */
export function spawnDetached(
  command: string,
  args: string[],
  spawnImpl: typeof nodeSpawn = nodeSpawn,
): SpawnedChild {
  let exit: number | null = null;
  const child: ChildProcess = spawnImpl(command, args, {
    detached: true,
    shell: false,
    stdio: "ignore",
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
  const spawn = opts.spawn ?? ((command, args) => spawnDetached(command, args));
  const isAlive = opts.isAlive ?? isPidAlive;
  const pingPort = opts.ping ?? ((port: number) => ping(port));
  const startTimeoutMs = opts.startTimeoutMs ?? 10_000;
  const pollMs = opts.pollMs ?? 100;
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

  async function locate(dataDir: string): Promise<ServiceEndpoint | null> {
    const info = readServiceInfo(dataDir);
    if (info === null || info === "invalid") return null;
    if (!isAlive(info.pid)) return null;
    if (!(await pingPort(info.port))) return null;
    const token = readToken(dataDir);
    if (token === null) return null; // between ping and token write? treat as not ready yet
    return { baseUrl: baseUrl(info.port), token };
  }

  /** "Already running": the lock belongs to a live process other than our child. */
  function anotherInstanceHoldsLock(dataDir: string, childPid: number | undefined): boolean {
    const owner = readLockPid(dataDir);
    return owner !== null && owner !== childPid && isAlive(owner);
  }

  async function start(dataDir: string): Promise<ServiceEndpoint> {
    const found = await locate(dataDir);
    if (found) return found;

    assertNotInGitCheckout(dataDir, exists);
    const node = resolveNode();
    const entry = resolveServiceEntry(opts.extensionPath, exists);
    const child = spawn(node, [entry, "--data-dir", dataDir]);

    const deadline = performance.now() + startTimeoutMs;
    for (;;) {
      const ep = await locate(dataDir);
      if (ep) return ep;
      const code = child.exitCode();
      // Exit 1 with the lock held by someone else = lost a start race with another window:
      // keep waiting for the winner to publish service.json.
      if (code !== null && !anotherInstanceHoldsLock(dataDir, child.pid)) {
        throw new Error(`EM OS service exited (code ${code}) before it became ready`);
      }
      if (performance.now() >= deadline) {
        throw new Error(`EM OS service did not become ready within ${startTimeoutMs / 1000}s`);
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
