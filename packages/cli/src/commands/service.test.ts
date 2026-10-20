import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { runtimePaths, parseLockPid as serviceParseLockPid } from "@emos/service";
import { afterEach, describe, expect, it } from "vitest";
import { parseLockPid, readLockPid, runtimeFiles } from "../env.js";
import {
  capture,
  cleanup,
  deadPid,
  startFakeService,
  startTestService,
  testEnv,
  tmpDir,
  writeRuntimeFiles,
} from "../test-helpers.js";
import { createServiceCommand, resolveServiceEntry } from "./service.js";

afterEach(cleanup);

const LOCK_TEXTS = [
  '{"pid":123,"startedAt":"2026-10-20T16:00:00.000Z"}\n',
  "123\n",
  " 77 ",
  "",
  "abc",
  "{",
  '{"pid":"12"}',
  '{"pid":-1}',
  "12abc",
];

type Deps = Parameters<typeof createServiceCommand>[0];

async function service(dataDir: string, args: string[], deps: Partial<Deps> = {}) {
  const cmd = createServiceCommand({ cli: testEnv(dataDir), ...deps });
  const cap = capture();
  const code = await cmd.run(args, cap.io);
  return { code, out: cap.out(), err: cap.err() };
}

describe("runtime file layout", () => {
  it("matches @emos/service's runtimePaths", () => {
    const dataDir = join(tmpDir(), "d");
    expect(runtimeFiles(dataDir)).toEqual(runtimePaths(dataDir));
  });

  it.each(LOCK_TEXTS)("parseLockPid matches @emos/service for %j", (text) => {
    expect(parseLockPid(text)).toBe(serviceParseLockPid(text));
  });

  it("readLockPid reads both lock formats", () => {
    const dataDir = tmpDir();
    expect(readLockPid(dataDir)).toBeNull();
    mkdirSync(join(dataDir, "run"));
    writeFileSync(runtimeFiles(dataDir).lock, "7777\n");
    expect(readLockPid(dataDir)).toBe(7777);
    writeFileSync(
      runtimeFiles(dataDir).lock,
      '{"pid":8888,"startedAt":"2026-10-20T16:00:00.000Z"}',
    );
    expect(readLockPid(dataDir)).toBe(8888);
  });
});

describe("emos service status", () => {
  it("running: prints running, port and version", async () => {
    const svc = await startTestService();
    const { code, out } = await service(svc.dataDir, ["status"]);
    expect(code).toBe(0);
    expect(out).toMatch(
      new RegExp(`^running on port ${svc.port} \\(pid \\d+, version 0\\.0\\.0\\)`),
    );
  });

  it("stopped: prints stopped, exit 0", async () => {
    const { code, out } = await service(tmpDir(), ["status"]);
    expect(code).toBe(0);
    expect(out).toBe("stopped\n");
  });

  it("a live pid that does not answer reads as not responding (exit 1)", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: process.pid, port: 1 });
    const { code, out } = await service(dataDir, ["status"]);
    expect(code).toBe(1);
    expect(out).toBe(`not responding on port 1 (pid ${process.pid})\n`);
  });

  it("a stale service.json reads as stopped", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: deadPid(), port: 1 });
    const { out } = await service(dataDir, ["status"]);
    expect(out).toBe("stopped\n");
  });
});

describe("emos service start", () => {
  it("already running: says so with the port and does not spawn", async () => {
    const svc = await startTestService();
    const spawned: string[][] = [];
    const { code, out } = await service(svc.dataDir, ["start"], {
      spawnService: (a) => {
        spawned.push(a);
        return undefined;
      },
    });
    expect(code).toBe(0);
    expect(out).toBe(`already running on port ${svc.port}\n`);
    expect(spawned).toEqual([]);
  });

  it("rejects a bad --port and unknown arguments (usage, exit 2)", async () => {
    for (const args of [
      ["start", "--port", "70000"],
      ["start", "--port", "x"],
      ["start", "extra"],
    ]) {
      const { code, err } = await service(tmpDir(), args);
      expect(code).toBe(2);
      expect(err).toContain("Usage: emos service");
    }
  });

  it("refuses a data dir inside a git checkout before spawning", async () => {
    const repo = tmpDir();
    mkdirSync(join(repo, ".git"));
    const { code, err } = await service(join(repo, "data"), ["start"], {
      spawnService: () => {
        throw new Error("must not spawn");
      },
    });
    expect(code).toBe(1);
    expect(err).toContain("git checkout");
  });

  it("times out when the service never answers", async () => {
    const { code, err } = await service(tmpDir(), ["start"], {
      spawnService: () => undefined,
      startTimeoutMs: 300,
      pollMs: 20,
    });
    expect(code).toBe(1);
    expect(err).toContain("did not become ready");
  });

  it("spawns in the data dir with output appended to logs/service.log", async () => {
    const dataDir = tmpDir();
    let seen: { cwd: string; logFd: number } | undefined;
    await service(dataDir, ["start"], {
      spawnService: (_a, o) => {
        seen = o;
        writeSync(o.logFd, "info service.starting\n");
        return undefined;
      },
      startTimeoutMs: 50,
      pollMs: 10,
    });
    expect(seen?.cwd).toBe(dataDir);
    const log = join(dataDir, "logs", "service.log");
    expect(readFileSync(log, "utf8")).toBe("info service.starting\n");
    if (process.platform !== "win32") expect(statSync(log).mode & 0o777).toBe(0o600);
  });

  it("an early exit prints the last log lines", async () => {
    const { code, err } = await service(tmpDir(), ["start"], {
      spawnService: (_a, o) => {
        writeSync(o.logFd, "emos-service: EM OS service already running (pid 7)\n");
        return { exitCode: () => 1 };
      },
      pollMs: 10,
    });
    expect(code).toBe(1);
    expect(err).toMatch(/exited \(code 1\) before it became ready\. Last log lines/);
    expect(err).toContain("already running (pid 7)");
  });

  it("a timeout prints the last log lines", async () => {
    const { code, err } = await service(tmpDir(), ["start"], {
      spawnService: (_a, o) => {
        writeSync(o.logFd, "warn service.port_unavailable\n");
        return undefined;
      },
      startTimeoutMs: 60,
      pollMs: 10,
    });
    expect(code).toBe(1);
    expect(err).toMatch(/did not become ready within .*\n.*port_unavailable/);
  });

  it("passes the resolved data dir and port to the spawned entry", async () => {
    const dataDir = tmpDir();
    let seen: string[] = [];
    await service(dataDir, ["start", "--port", "4242"], {
      spawnService: (a) => {
        seen = a;
        return undefined;
      },
      startTimeoutMs: 100,
      pollMs: 20,
    });
    expect(seen).toEqual(["--data-dir", dataDir, "--port", "4242"]);
  });
});

describe("emos service stop", () => {
  it("not running: exit 0", async () => {
    const { code, out } = await service(tmpDir(), ["stop"]);
    expect(code).toBe(0);
    expect(out).toBe("not running\n");
  });

  it("a stale pid is not signalled", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: deadPid(), port: 1 });
    const { code, out } = await service(dataDir, ["stop"], {
      kill: () => {
        throw new Error("must not kill");
      },
    });
    expect(code).toBe(0);
    expect(out).toBe("not running\n");
  });

  it("a live pid that does not answer is not signalled (it may be a recycled pid)", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: process.pid, port: 1 });
    const { code, err } = await service(dataDir, ["stop"], {
      kill: () => {
        throw new Error("must not kill");
      },
    });
    expect(code).toBe(1);
    expect(err).toContain("not answering");
  });

  it("asks the service to shut down (service.shutdown) and does not signal it", async () => {
    const dataDir = tmpDir();
    const files = runtimeFiles(dataDir);
    const port = await startFakeService(1, {
      onShutdown: () => {
        rmSync(files.lock, { force: true });
        rmSync(files.serviceJson, { force: true });
      },
    });
    writeRuntimeFiles(dataDir, { pid: process.pid, port });
    writeFileSync(
      files.lock,
      JSON.stringify({ pid: process.pid, startedAt: "2026-10-20T16:00:00.000Z" }),
    );
    const killed: number[] = [];
    const { code, out } = await service(dataDir, ["stop"], {
      kill: (pid) => {
        killed.push(pid);
      },
      pollMs: 10,
    });
    expect(code).toBe(0);
    expect(out).toBe("stopped\n");
    expect(killed).toEqual([]);
  });

  it("falls back to a signal if the shutdown is accepted but the lock stays", async () => {
    const dataDir = tmpDir();
    const lock = runtimeFiles(dataDir).lock;
    writeRuntimeFiles(dataDir, {
      pid: process.pid,
      port: await startFakeService(1, { onShutdown: () => {} }),
    });
    writeFileSync(lock, `${process.pid}\n`);
    const killed: number[] = [];
    const { code, out } = await service(dataDir, ["stop"], {
      kill: (pid) => {
        killed.push(pid);
        setTimeout(() => rmSync(lock), 20);
      },
      stopTimeoutMs: 200,
      pollMs: 10,
    });
    expect(code).toBe(0);
    expect(out).toBe("stopped\n");
    expect(killed).toEqual([process.pid]);
  });

  it("a service without service.shutdown: signals the pid and waits for the lock to disappear", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: process.pid, port: await startFakeService(1) });
    const lock = runtimeFiles(dataDir).lock;
    writeFileSync(lock, `${process.pid}\n`);
    const killed: Array<[number, NodeJS.Signals | undefined]> = [];
    const { code, out } = await service(dataDir, ["stop"], {
      kill: (pid, signal) => {
        killed.push([pid, signal]);
        setTimeout(() => rmSync(lock), 50);
      },
      pollMs: 10,
    });
    expect(code).toBe(0);
    expect(out).toBe("stopped\n");
    expect(killed).toEqual([[process.pid, process.platform === "win32" ? undefined : "SIGTERM"]]);
  });

  it("a hard kill (no graceful cleanup): dead pid counts as stopped and leftovers are removed", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: process.pid, port: await startFakeService(1) });
    const files = runtimeFiles(dataDir);
    writeFileSync(files.lock, `${process.pid}\n`);
    let alive = true;
    const { code, out } = await service(dataDir, ["stop"], {
      kill: () => {
        alive = false; // TerminateProcess: the process dies, the files stay
      },
      isAlive: () => alive,
      stopTimeoutMs: 2000,
      pollMs: 10,
    });
    expect(code).toBe(0);
    expect(out).toBe("stopped\n");
    expect(existsSync(files.lock)).toBe(false);
    expect(existsSync(files.serviceJson)).toBe(false);
  });

  it("does not remove files that belong to another pid", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: process.pid, port: await startFakeService(1) });
    const files = runtimeFiles(dataDir);
    writeFileSync(files.lock, "424242\n"); // some other instance took over
    let alive = true;
    const { code } = await service(dataDir, ["stop"], {
      kill: () => {
        alive = false;
      },
      isAlive: () => alive,
      stopTimeoutMs: 2000,
      pollMs: 10,
    });
    expect(code).toBe(0);
    expect(existsSync(files.lock)).toBe(true);
  });

  it("fails if the lock is still there after the timeout", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: process.pid, port: await startFakeService(1) });
    writeFileSync(runtimeFiles(dataDir).lock, `${process.pid}\n`);
    const { code, err } = await service(dataDir, ["stop"], {
      kill: () => {},
      stopTimeoutMs: 100,
      pollMs: 10,
    });
    expect(code).toBe(1);
    expect(err).toContain("did not stop");
  });
});

describe("service entry", () => {
  it("resolves @emos/service's built main.js", () => {
    const entry = resolveServiceEntry();
    expect(entry.endsWith("main.js")).toBe(true);
    expect(existsSync(entry)).toBe(true);
  });
});

// One real spawn: detached child process, stopped with the service.shutdown op. It runs a stub
// entry that wraps the real startService with an in-memory secret store, because the built
// `dist/main.js` would use the real OS keychain and tests must never touch it. Skipped on
// Windows for now (process-tree and signal behaviour there is untested; try it once CI runs).
describe.skipIf(process.platform === "win32")("service start/stop (real process)", () => {
  it("starts detached, reports status, is idempotent, then stops", async () => {
    const dataDir = tmpDir();
    const stubDir = tmpDir();
    const stub = join(stubDir, "stub-service.mjs");
    const serviceUrl = import.meta.resolve("@emos/service");
    writeFileSync(
      stub,
      `import { startService, createMemorySecretStore, parseArgs } from ${JSON.stringify(serviceUrl)};
import { homedir } from "node:os";
const args = parseArgs(process.argv.slice(2), process.env, process.platform, homedir());
const svc = await startService({ ...args, secrets: createMemorySecretStore(), log: { info() {}, warn() {}, error() {} }, onShutdown: () => process.exit(0) });
process.on("SIGTERM", () => svc.stop().then(() => process.exit(0), () => process.exit(1)));
`,
    );
    const deps = { serviceEntry: stub, pollMs: 50 };

    const started = await service(dataDir, ["start", "--port", "0"], deps);
    expect(started.err).toBe("");
    expect(started.code).toBe(0);
    const info = JSON.parse(readFileSync(runtimeFiles(dataDir).serviceJson, "utf8"));
    expect(started.out).toBe(`started on port ${info.port}\n`);

    try {
      const ping = await fetch(`http://127.0.0.1:${info.port}/health/ping`);
      expect(await ping.text()).toBe("ok");

      const status = await service(dataDir, ["status"], deps);
      expect(status.out).toContain(`running on port ${info.port}`);

      const again = await service(dataDir, ["start"], deps);
      expect(again.out).toBe(`already running on port ${info.port}\n`);
      expect(again.code).toBe(0);
    } finally {
      const stopped = await service(dataDir, ["stop"], {
        ...deps,
        kill: () => {
          throw new Error("stop must not need a signal: service.shutdown handles it");
        },
      });
      expect(stopped.code).toBe(0);
      expect(stopped.out).toBe("stopped\n");
    }
    expect(existsSync(runtimeFiles(dataDir).lock)).toBe(false);
    expect((await service(dataDir, ["status"], deps)).out).toBe("stopped\n");
  }, 30_000);
});
