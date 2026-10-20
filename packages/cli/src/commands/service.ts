import { spawn } from "node:child_process";
import { closeSync, existsSync, realpathSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assertNotInGitCheckout } from "@emos/store-sqlite";
import { type Command, EXIT_FAILURE, EXIT_OK } from "../command.js";
import {
  type CliEnv,
  defaultCliEnv,
  guarded,
  isPidAlive,
  parseFlags,
  probeService,
  readLockPid,
  readServiceInfo,
  resolveDataDirFor,
  runtimeFiles,
  UsageError,
} from "../env.js";
import { openServiceLog, withLogTail } from "../service-log.js";

const USAGE = [
  "Usage: emos service start [--data-dir <path>] [--port <n>]",
  "       emos service stop [--data-dir <path>]",
  "       emos service status [--data-dir <path>]",
].join("\n");

/** The service's `main.js`, resolved through its package `exports` (`@emos/service/main`). */
export function resolveServiceEntry(): string {
  return fileURLToPath(import.meta.resolve("@emos/service/main"));
}

/** A running child: `exitCode()` is null while it is alive. */
export interface SpawnedService {
  exitCode(): number | null;
}

export interface ServiceDeps {
  cli?: CliEnv;
  /** Path of the service entry script. Default: {@link resolveServiceEntry}. */
  serviceEntry?: string;
  /**
   * Starts the service detached with these `--data-dir`/`--port` arguments, in `cwd` (the data
   * dir), with stdout/stderr on `logFd` (`logs/service.log`, append).
   */
  spawnService?: (
    args: string[],
    opts: { cwd: string; logFd: number },
  ) => SpawnedService | undefined;
  /** Signals the service to stop. Default: SIGTERM (Windows: `process.kill(pid)`). */
  kill?: (pid: number, signal?: NodeJS.Signals) => void;
  /** Is this pid still running? Default: `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  pollMs?: number;
}

/**
 * Detached, no shell, output to the log file (never a pipe): the service must outlive this
 * process. The cwd is the data dir, so it never holds a user folder open (Windows locks a cwd).
 */
function spawnDetached(
  entry: string,
  args: string[],
  opts: { cwd: string; logFd: number },
): SpawnedService {
  let exit: number | null = null;
  const child = spawn(process.execPath, [entry, ...args], {
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
  return { exitCode: () => exit };
}

/** Removes `service.lock` / `service.json` left by a process that died without cleaning up. */
function removeLeftovers(dataDir: string, pid: number): void {
  const files = runtimeFiles(dataDir);
  if (readLockPid(dataDir) === pid) rmSync(files.lock, { force: true });
  const info = readServiceInfo(dataDir);
  if (info !== null && info !== "invalid" && info.pid === pid) {
    rmSync(files.serviceJson, { force: true });
  }
}

function defaultKill(pid: number, signal?: NodeJS.Signals): void {
  if (process.platform === "win32") process.kill(pid);
  else process.kill(pid, signal ?? "SIGTERM");
}

export function createServiceCommand(deps: ServiceDeps = {}): Command {
  const cli = deps.cli ?? defaultCliEnv();
  const startTimeoutMs = deps.startTimeoutMs ?? 10_000;
  const stopTimeoutMs = deps.stopTimeoutMs ?? 5_000;
  const pollMs = deps.pollMs ?? 100;
  const kill = deps.kill ?? defaultKill;
  const isAlive = deps.isAlive ?? isPidAlive;
  const spawnService =
    deps.spawnService ??
    ((args: string[], o: { cwd: string; logFd: number }) =>
      spawnDetached(deps.serviceEntry ?? resolveServiceEntry(), args, o));

  async function start(args: string[], io: Parameters<Command["run"]>[1]): Promise<number> {
    const { values } = parseFlags(
      args,
      { "data-dir": { type: "string" }, port: { type: "string" } },
      { min: 0, max: 0 },
    );
    const port = values.port;
    if (port !== undefined && (!/^\d{1,5}$/.test(port) || Number(port) > 65535)) {
      throw new UsageError(`Invalid --port: ${port} (expected 0-65535)`);
    }
    const dataDir = resolveDataDirFor(cli, values["data-dir"]);

    const current = await probeService(dataDir);
    if (current.state === "running") {
      io.out(`already running on port ${current.info.port}\n`);
      return EXIT_OK;
    }
    try {
      let real = dataDir;
      try {
        real = realpathSync(dataDir);
      } catch {
        // not created yet: check the path as given
      }
      assertNotInGitCheckout(real, existsSync);
    } catch {
      io.err(`error: the data dir is inside a git checkout: ${dataDir}\n`);
      return EXIT_FAILURE;
    }

    const log = openServiceLog(dataDir);
    let child: SpawnedService | undefined;
    try {
      child = spawnService(
        ["--data-dir", dataDir, ...(port !== undefined ? ["--port", port] : [])],
        { cwd: dataDir, logFd: log.fd },
      );
    } finally {
      closeSync(log.fd); // the child has its own copy
    }
    const deadline = performance.now() + startTimeoutMs;
    for (;;) {
      const now = await probeService(dataDir);
      if (now.state === "running") {
        io.out(`started on port ${now.info.port}\n`);
        return EXIT_OK;
      }
      const code = child ? child.exitCode() : null;
      if (code !== null) {
        io.err(
          `error: ${withLogTail(`the service exited (code ${code}) before it became ready`, log)}\n`,
        );
        return EXIT_FAILURE;
      }
      if (performance.now() >= deadline) {
        io.err(
          `error: ${withLogTail(`the service did not become ready within ${startTimeoutMs / 1000}s`, log)}\n`,
        );
        return EXIT_FAILURE;
      }
      await sleep(pollMs);
    }
  }

  async function stop(args: string[], io: Parameters<Command["run"]>[1]): Promise<number> {
    const { values } = parseFlags(args, { "data-dir": { type: "string" } }, { min: 0, max: 0 });
    const dataDir = resolveDataDirFor(cli, values["data-dir"]);
    const svc = await probeService(dataDir);
    if (svc.state === "stopped") {
      io.out("not running\n");
      return EXIT_OK;
    }
    if (svc.state === "unresponsive") {
      // Never signal a pid we cannot tie to the service: it may be a recycled pid.
      io.err(
        `error: pid ${svc.info.pid} is alive but not answering on port ${svc.info.port}; not signalling it\n`,
      );
      return EXIT_FAILURE;
    }
    try {
      kill(svc.info.pid, process.platform === "win32" ? undefined : "SIGTERM");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
    }
    const files = runtimeFiles(dataDir);
    const pid = svc.info.pid;
    const deadline = performance.now() + stopTimeoutMs;
    // A hard kill (Windows `process.kill`) skips the service's cleanup: the process is gone but
    // its lock and service.json remain. A dead pid is as good as a released lock.
    while (existsSync(files.lock) && isAlive(pid)) {
      if (performance.now() >= deadline) {
        io.err(`error: the service did not stop within ${stopTimeoutMs / 1000}s\n`);
        return EXIT_FAILURE;
      }
      await sleep(pollMs);
    }
    if (!isAlive(pid)) removeLeftovers(dataDir, pid);
    io.out("stopped\n");
    return EXIT_OK;
  }

  async function status(args: string[], io: Parameters<Command["run"]>[1]): Promise<number> {
    const { values } = parseFlags(args, { "data-dir": { type: "string" } }, { min: 0, max: 0 });
    const dataDir = resolveDataDirFor(cli, values["data-dir"]);
    const svc = await probeService(dataDir);
    if (svc.state === "running") {
      const { port, pid, serviceVersion } = svc.info;
      io.out(`running on port ${port} (pid ${pid}, version ${serviceVersion})\n`);
      return EXIT_OK;
    }
    if (svc.state === "unresponsive") {
      io.out(`not responding on port ${svc.info.port} (pid ${svc.info.pid})\n`);
      return EXIT_FAILURE;
    }
    io.out("stopped\n");
    return EXIT_OK;
  }

  return {
    name: "service",
    summary: "Control the local service: start, stop or status",
    run: (args, io) =>
      guarded(USAGE, io, async () => {
        const [sub, ...rest] = args;
        if (sub === "start") return start(rest, io);
        if (sub === "stop") return stop(rest, io);
        if (sub === "status") return status(rest, io);
        throw new UsageError(sub ? `Unknown subcommand: ${sub}` : "Missing subcommand");
      }),
  };
}

export const serviceCommand: Command = createServiceCommand();
