// What every command needs to find the service: the environment (injectable for tests), the
// data directory, the runtime files in `<dataDir>/run/` and a liveness probe.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import type { ServiceInfo } from "@emos/service";
import { dataLayout, resolveDataDir } from "@emos/store-sqlite";
import { type CommandIo, EXIT_FAILURE, EXIT_USAGE } from "./command.js";

export interface CliEnv {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homedir: string;
  cwd: string;
}

export function defaultCliEnv(): CliEnv {
  return { env: process.env, platform: process.platform, homedir: homedir(), cwd: process.cwd() };
}

/** `--data-dir` if given, else the platform data directory (`EMOS_DATA_DIR` wins there). */
export function resolveDataDirFor(cli: CliEnv, flag?: string): string {
  return flag || resolveDataDir(cli.env, cli.platform, cli.homedir);
}

/**
 * Locations of the runtime files. Mirrors `runtimePaths` in @emos/service (a test pins the
 * two together); not imported from there so that running `emos` does not load the service
 * (and its native keychain module) just to join a few paths.
 */
export function runtimeFiles(dataDir: string): {
  runDir: string;
  serviceJson: string;
  token: string;
  lock: string;
} {
  const { runDir } = dataLayout(dataDir);
  return {
    runDir,
    serviceJson: join(runDir, "service.json"),
    token: join(runDir, "token"),
    lock: join(runDir, "service.lock"),
  };
}

/** `run/service.json`: null when absent, `"invalid"` when unreadable or malformed. */
export function readServiceInfo(dataDir: string): ServiceInfo | null | "invalid" {
  let text: string;
  try {
    text = readFileSync(runtimeFiles(dataDir).serviceJson, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "invalid";
  }
  try {
    const v = JSON.parse(text) as Partial<ServiceInfo> | null;
    if (
      v &&
      Number.isInteger(v.pid) &&
      Number.isInteger(v.port) &&
      (v.port as number) > 0 &&
      (v.port as number) <= 65535 &&
      typeof v.serviceVersion === "string"
    ) {
      return v as ServiceInfo;
    }
  } catch {
    // fall through
  }
  return "invalid";
}

/**
 * The owner pid in `run/service.lock`: `{"pid":1234,…}` or the old bare `1234`. Null when
 * unparseable. Mirrors `parseLockPid` in @emos/service (a test pins the two together).
 */
export function parseLockPid(text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) return Number(t);
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t) as { pid?: unknown } | null;
    const pid = v?.pid;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** The pid in `run/service.lock` (either format), or null when absent or unparseable. */
export function readLockPid(dataDir: string): number | null {
  try {
    return parseLockPid(readFileSync(runtimeFiles(dataDir).lock, "utf8"));
  } catch {
    return null;
  }
}

export function readToken(dataDir: string): string | null {
  try {
    return readFileSync(runtimeFiles(dataDir).token, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** `process.kill(pid, 0)`: ESRCH = dead, EPERM = alive but not ours. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `GET /health/ping` answers 200 "ok" (unauthenticated). False on any failure or timeout. */
export async function ping(port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(port)}/health/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200 && (await res.text()) === "ok";
  } catch {
    return false;
  }
}

export type ServiceState =
  | { state: "stopped"; stale?: ServiceInfo }
  | { state: "unresponsive"; info: ServiceInfo }
  | { state: "running"; info: ServiceInfo };

/**
 * `run/service.json` says where the service is, but a crash leaves it behind, so it counts only
 * if its pid is alive and the port answers the ping.
 */
export async function probeService(dataDir: string): Promise<ServiceState> {
  const info = readServiceInfo(dataDir);
  if (info === null || info === "invalid") return { state: "stopped" };
  if (!isPidAlive(info.pid)) return { state: "stopped", stale: info };
  return (await ping(info.port)) ? { state: "running", info } : { state: "unresponsive", info };
}

export class UsageError extends Error {}

/**
 * Parses `args` with node's built-in parser (no dependency). Unknown options, missing values
 * and a wrong number of positionals throw {@link UsageError}.
 */
export function parseFlags<const O extends Record<string, { type: "string" }>>(
  args: string[],
  options: O,
  positionals: { min: number; max: number },
): { values: { [K in keyof O]?: string }; positionals: string[] } {
  let parsed: ReturnType<typeof parseNodeArgs>;
  try {
    parsed = parseNodeArgs({ args, options, strict: true, allowPositionals: true });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const n = parsed.positionals.length;
  if (n < positionals.min) throw new UsageError("Missing argument");
  if (n > positionals.max)
    throw new UsageError(`Unexpected argument: ${parsed.positionals[positionals.max]}`);
  return {
    values: parsed.values as { [K in keyof O]?: string },
    positionals: parsed.positionals,
  };
}

/**
 * Runs a command body: a {@link UsageError} prints the error and `usage` (exit 2); any other
 * thrown error prints its message (exit 1).
 */
export async function guarded(
  usage: string,
  io: CommandIo,
  body: () => Promise<number>,
): Promise<number> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`error: ${e.message}\n${usage}\n`);
      return EXIT_USAGE;
    }
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT_FAILURE;
  }
}
