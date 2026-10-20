import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLauncher,
  type LauncherOptions,
  type ServiceSpawnOptions,
  type SpawnedChild,
  spawnDetached,
} from "./launcher.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A temp data dir (space + Unicode in the name). Never the real data dir. */
function tmpDataDir(): string {
  const d = mkdtempSync(join(tmpdir(), "emos ext zoë-"));
  dirs.push(d);
  return d;
}

const TOKEN = "a".repeat(43);

function writeServiceJson(dataDir: string, info: { pid: number; port: number }): void {
  mkdirSync(join(dataDir, "run"), { recursive: true });
  writeFileSync(
    join(dataDir, "run", "service.json"),
    JSON.stringify({
      ...info,
      apiVersion: 1,
      serviceVersion: "0.0.0",
      startedAt: "2026-10-20T16:00:00.000Z",
    }),
  );
}

function writeToken(dataDir: string, token = TOKEN): void {
  mkdirSync(join(dataDir, "run"), { recursive: true });
  writeFileSync(join(dataDir, "run", "token"), token, { mode: 0o600 });
}

// Built with join() so the expectations hold on Windows too.
const SERVICE_MAIN = join("/ext", "dist", "service", "main.js");
const BUNDLED_NODE = join("/ext", "dist", "runtime", "node");

const LIVE_PID = 4242;
const LIVE_PORT = 5555;

/**
 * A simulated world: `alive` pids and `listening` ports. `spawn` records its calls and, unless
 * told otherwise, "starts" a service that writes its runtime files after `delayMs`.
 */
function world(
  dataDir: string,
  behaviour: { delayMs?: number; exitCode?: number; output?: string } = {},
) {
  const alive = new Set<number>();
  const listening = new Set<number>();
  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  const spawnOpts: ServiceSpawnOptions[] = [];
  const spawn = vi.fn((command: string, args: string[], o: ServiceSpawnOptions): SpawnedChild => {
    spawnCalls.push({ command, args });
    spawnOpts.push(o);
    if (behaviour.output) writeSync(o.logFd, behaviour.output);
    let exit: number | null = null;
    if (behaviour.exitCode !== undefined) {
      exit = behaviour.exitCode;
    } else {
      setTimeout(() => {
        alive.add(LIVE_PID);
        listening.add(LIVE_PORT);
        writeToken(dataDir);
        writeServiceJson(dataDir, { pid: LIVE_PID, port: LIVE_PORT });
      }, behaviour.delayMs ?? 30);
    }
    return { pid: 9001, exitCode: () => exit };
  });
  const health = vi.fn(async (_ep: { baseUrl: string; token: string }) => ({
    serviceVersion: "0.0.0",
    apiVersion: 1,
  }));
  const opts: LauncherOptions = {
    expectedServiceVersion: "0.0.0",
    health,
    extensionPath: "/ext",
    allowPathNode: true,
    env: { EMOS_NODE_PATH: "/opt/node/bin/node" },
    platform: "darwin",
    exists: (p) => p === "/opt/node/bin/node" || p === SERVICE_MAIN,
    spawn,
    isAlive: (pid) => alive.has(pid),
    ping: async (port) => listening.has(port),
    pollMs: 5,
    startTimeoutMs: 1000,
  };
  return { alive, listening, spawn, spawnCalls, spawnOpts, opts, health };
}

describe("ensureService", () => {
  it("attaches to a live service without spawning", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir);
    w.alive.add(LIVE_PID);
    w.listening.add(LIVE_PORT);
    writeServiceJson(dataDir, { pid: LIVE_PID, port: LIVE_PORT });
    writeToken(dataDir);
    const ep = await createLauncher(w.opts).ensureService(dataDir);
    expect(ep).toEqual({ baseUrl: `http://127.0.0.1:${LIVE_PORT}`, token: TOKEN });
    expect(w.spawn).not.toHaveBeenCalled();
  });

  it("a stale service.json (dead pid) spawns once, then attaches", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir);
    writeServiceJson(dataDir, { pid: 999_999, port: 6666 }); // pid not alive
    const ep = await createLauncher(w.opts).ensureService(dataDir);
    expect(w.spawn).toHaveBeenCalledTimes(1);
    expect(w.spawnCalls[0]).toEqual({
      command: "/opt/node/bin/node",
      args: [SERVICE_MAIN, "--data-dir", dataDir],
    });
    expect(ep).toEqual({ baseUrl: `http://127.0.0.1:${LIVE_PORT}`, token: TOKEN });
  });

  it("spawns when the pid is alive but the port does not answer", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir);
    w.alive.add(1234); // e.g. a recycled pid
    writeServiceJson(dataDir, { pid: 1234, port: 6666 });
    await createLauncher(w.opts).ensureService(dataDir);
    expect(w.spawn).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls spawn only once (in-process mutex)", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, { delayMs: 50 });
    const launcher = createLauncher(w.opts);
    const results = await Promise.all([
      launcher.ensureService(dataDir),
      launcher.ensureService(dataDir),
      launcher.ensureService(dataDir),
    ]);
    expect(w.spawn).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.token).toBe(TOKEN);
  });

  it("a child that exits 'already running' (another window won the race) attaches to the winner", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, { exitCode: 1 });
    // The other window's service holds the lock and publishes service.json a little later.
    mkdirSync(join(dataDir, "run"), { recursive: true });
    writeFileSync(join(dataDir, "run", "service.lock"), "7777\n");
    w.alive.add(7777);
    setTimeout(() => {
      w.listening.add(LIVE_PORT);
      writeToken(dataDir);
      writeServiceJson(dataDir, { pid: 7777, port: LIVE_PORT });
    }, 40);
    const ep = await createLauncher(w.opts).ensureService(dataDir);
    expect(w.spawn).toHaveBeenCalledTimes(1);
    expect(ep.baseUrl).toBe(`http://127.0.0.1:${LIVE_PORT}`);
  });

  it("a child that exits for any other reason fails fast with a clear error", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, { exitCode: 1 });
    const started = performance.now();
    await expect(createLauncher(w.opts).ensureService(dataDir)).rejects.toThrow(
      /exited \(code 1\) before it became ready/,
    );
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("runs the service in the data dir with stdout/stderr appended to logs/service.log", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, { output: "2026-10-20T16:00:00.000Z info service.started\n" });
    await createLauncher(w.opts).ensureService(dataDir);
    expect(w.spawnOpts[0]?.cwd).toBe(dataDir);
    expect(typeof w.spawnOpts[0]?.logFd).toBe("number");
    const log = join(dataDir, "logs", "service.log");
    expect(readFileSync(log, "utf8")).toContain("service.started");
    if (process.platform !== "win32") expect(statSync(log).mode & 0o777).toBe(0o600);
  });

  it("an early exit includes the last log lines in the error", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, {
      exitCode: 1,
      output: "emos-service: Database is locked\n",
    });
    await expect(createLauncher(w.opts).ensureService(dataDir)).rejects.toThrow(
      /exited \(code 1\) before it became ready\. Last log lines .*\n.*Database is locked/,
    );
  });

  it("a not-ready timeout includes the last log lines too", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, { delayMs: 10_000, output: "warn service.port_unavailable\n" });
    await expect(
      createLauncher({ ...w.opts, startTimeoutMs: 60 }).ensureService(dataDir),
    ).rejects.toThrow(/did not become ready within .*\n.*port_unavailable/);
  });

  it("refuses a data dir inside a git checkout before spawning", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir);
    const exists = (p: string) => p === join(dataDir, ".git") || (w.opts.exists?.(p) ?? false);
    await expect(createLauncher({ ...w.opts, exists }).ensureService(dataDir)).rejects.toThrow(
      /inside a git checkout/,
    );
    expect(w.spawn).not.toHaveBeenCalled();
  });

  it("gives up after the start timeout", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, { delayMs: 10_000 });
    await expect(
      createLauncher({ ...w.opts, startTimeoutMs: 60 }).ensureService(dataDir),
    ).rejects.toThrow(/did not become ready/);
  });

  it("after a failure the next call tries again (the mutex is released)", async () => {
    const dataDir = tmpDataDir();
    const w = world(dataDir, { exitCode: 1 });
    const launcher = createLauncher(w.opts);
    await expect(launcher.ensureService(dataDir)).rejects.toThrow();
    await expect(launcher.ensureService(dataDir)).rejects.toThrow();
    expect(w.spawn).toHaveBeenCalledTimes(2);
  });
});

describe("version-aware attach", () => {
  const OLD_PID = 3131;
  const OLD_PORT = 7777;

  /** An old service is running (pid OLD_PID on OLD_PORT, holding the lock). */
  function withOldService(
    dataDir: string,
    version: { serviceVersion: string; apiVersion: number } | "incompatible",
  ) {
    const w = world(dataDir);
    w.alive.add(OLD_PID);
    w.listening.add(OLD_PORT);
    writeServiceJson(dataDir, { pid: OLD_PID, port: OLD_PORT });
    writeToken(dataDir);
    writeFileSync(join(dataDir, "run", "service.lock"), `${JSON.stringify({ pid: OLD_PID })}\n`);
    const goAway = () => {
      w.alive.delete(OLD_PID);
      w.listening.delete(OLD_PORT);
      rmSync(join(dataDir, "run", "service.lock"), { force: true });
      rmSync(join(dataDir, "run", "service.json"), { force: true });
    };
    const health = vi.fn(async (ep: { baseUrl: string }) => {
      if (ep.baseUrl.endsWith(`:${OLD_PORT}`)) {
        if (version === "incompatible") return "incompatible" as const;
        return version;
      }
      return { serviceVersion: "0.0.0", apiVersion: 1 };
    });
    return { w, goAway, health };
  }

  it("attaches without restarting when the versions match", async () => {
    const dataDir = tmpDataDir();
    const { w, health } = withOldService(dataDir, { serviceVersion: "0.0.0", apiVersion: 1 });
    const shutdown = vi.fn(async () => true);
    const ep = await createLauncher({ ...w.opts, health, shutdown }).ensureService(dataDir);
    expect(ep.baseUrl).toBe(`http://127.0.0.1:${OLD_PORT}`);
    expect(shutdown).not.toHaveBeenCalled();
    expect(w.spawn).not.toHaveBeenCalled();
  });

  it("a different serviceVersion: shuts the old one down, waits for the lock, respawns", async () => {
    const dataDir = tmpDataDir();
    const { w, goAway, health } = withOldService(dataDir, {
      serviceVersion: "0.9.0",
      apiVersion: 1,
    });
    const shutdown = vi.fn(async (ep: { baseUrl: string }) => {
      expect(ep.baseUrl).toBe(`http://127.0.0.1:${OLD_PORT}`);
      setTimeout(goAway, 20);
      return true;
    });
    const kill = vi.fn();
    const ep = await createLauncher({ ...w.opts, health, shutdown, kill }).ensureService(dataDir);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    expect(w.spawn).toHaveBeenCalledTimes(1);
    expect(ep.baseUrl).toBe(`http://127.0.0.1:${LIVE_PORT}`);
  });

  it("a different apiVersion (or a 409 incompatible_version) is a mismatch too", async () => {
    for (const version of [{ serviceVersion: "0.0.0", apiVersion: 2 }, "incompatible" as const]) {
      const dataDir = tmpDataDir();
      const { w, goAway, health } = withOldService(dataDir, version);
      const shutdown = vi.fn(async () => {
        goAway();
        return true;
      });
      const ep = await createLauncher({ ...w.opts, health, shutdown }).ensureService(dataDir);
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(ep.baseUrl).toBe(`http://127.0.0.1:${LIVE_PORT}`);
    }
  });

  it("falls back to killing the old pid when the lock does not clear in time", async () => {
    const dataDir = tmpDataDir();
    const { w, goAway, health } = withOldService(dataDir, {
      serviceVersion: "0.9.0",
      apiVersion: 1,
    });
    const shutdown = vi.fn(async () => false); // e.g. an old service without the op
    const kill = vi.fn((pid: number) => {
      expect(pid).toBe(OLD_PID);
      goAway();
    });
    const ep = await createLauncher({
      ...w.opts,
      health,
      shutdown,
      kill,
      stopTimeoutMs: 50,
    }).ensureService(dataDir);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(ep.baseUrl).toBe(`http://127.0.0.1:${LIVE_PORT}`);
  });

  it("an unreachable health check does not kill anything (attaches as before)", async () => {
    const dataDir = tmpDataDir();
    const { w } = withOldService(dataDir, { serviceVersion: "0.0.0", apiVersion: 1 });
    const shutdown = vi.fn(async () => true);
    const ep = await createLauncher({
      ...w.opts,
      health: async () => null,
      shutdown,
    }).ensureService(dataDir);
    expect(ep.baseUrl).toBe(`http://127.0.0.1:${OLD_PORT}`);
    expect(shutdown).not.toHaveBeenCalled();
  });
});

describe("Node runtime resolution (R14)", () => {
  const base = (over: Partial<LauncherOptions>): LauncherOptions => ({
    extensionPath: "/ext",
    allowPathNode: false,
    env: {},
    platform: "darwin",
    exists: () => false,
    ...over,
  });
  const nodeFor = (over: Partial<LauncherOptions>) => createLauncher(base(over)).resolveNode();

  it("EMOS_NODE_PATH wins", () => {
    expect(
      nodeFor({
        env: { EMOS_NODE_PATH: "/custom/node" },
        exists: (p) => p === "/custom/node" || p === BUNDLED_NODE,
      }),
    ).toBe("/custom/node");
  });

  it("a missing EMOS_NODE_PATH is an error, not a silent fallback", () => {
    expect(() => nodeFor({ env: { EMOS_NODE_PATH: "/nope/node" } })).toThrow(/EMOS_NODE_PATH/);
  });

  it("then the bundled runtime under dist/runtime (node.exe on Windows)", () => {
    expect(nodeFor({ exists: (p) => p === BUNDLED_NODE })).toBe(BUNDLED_NODE);
    expect(
      nodeFor({ platform: "win32", exists: (p) => p.endsWith("node.exe") }).endsWith("node.exe"),
    ).toBe(true);
  });

  it("`node` on PATH only in Development/Test mode", () => {
    expect(nodeFor({ allowPathNode: true })).toBe("node");
    expect(() => nodeFor({ allowPathNode: false })).toThrow(/EM OS runtime not found/);
  });

  it("never VS Code's own executable", () => {
    for (const allowPathNode of [true, false]) {
      try {
        expect(nodeFor({ allowPathNode })).not.toBe(process.execPath);
      } catch {
        // throwing is fine too
      }
    }
  });

  it("an unpackaged extension resolves @emos/service/main from the workspace", () => {
    const launcher = createLauncher(base({ extensionPath: join(import.meta.dirname, "..") }));
    expect(launcher.resolveServiceEntry()).toMatch(/service[/\\]dist[/\\]main\.js$/);
  });
});

describe("spawnDetached", () => {
  it("spawns detached in the data dir, without a shell, output to the log fd, and unrefs", () => {
    const unref = vi.fn();
    const on = vi.fn();
    const impl = vi.fn(() => ({ pid: 1, unref, on }));
    spawnDetached(
      "/opt/node",
      ["/svc/main.js", "--data-dir", "/d"],
      { cwd: "/d", logFd: 17 },
      impl as never,
    );
    expect(impl).toHaveBeenCalledWith(
      "/opt/node",
      ["/svc/main.js", "--data-dir", "/d"],
      expect.objectContaining({
        cwd: "/d",
        detached: true,
        shell: false,
        stdio: ["ignore", 17, 17],
        windowsHide: true,
      }),
    );
    expect(unref).toHaveBeenCalled();
  });
});
