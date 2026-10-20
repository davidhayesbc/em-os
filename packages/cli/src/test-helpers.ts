// Test-only helpers: real services on ephemeral ports in temp data dirs under os.tmpdir(),
// never inside the repo, with in-memory secrets (the real keychain is never touched).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemorySecretStore, startService } from "@emos/service";
import type { CliEnv } from "./env.js";

const dirs: string[] = [];
const running: Array<{ stop(): Promise<void> }> = [];
const servers: Array<{ close(cb: () => void): void }> = [];

/** A fresh temp dir (with a space and Unicode in its name, to exercise odd paths). */
export function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "emos cli zoë-"));
  dirs.push(dir);
  return dir;
}

export async function startTestService(dataDir = tmpDir()) {
  const svc = await startService({
    dataDir,
    port: 0,
    secrets: createMemorySecretStore(),
    log: { info() {}, warn() {}, error() {} },
  });
  running.push(svc);
  return { ...svc, dataDir };
}

export async function cleanup(): Promise<void> {
  for (const s of running.splice(0)) await s.stop();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(r));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** A `CliEnv` for tests: `EMOS_DATA_DIR` is set, so the real data dir is never consulted. */
export function testEnv(dataDir: string, overrides: Partial<CliEnv> = {}): CliEnv {
  return {
    env: { EMOS_DATA_DIR: dataDir },
    platform: process.platform,
    homedir: tmpDir(),
    cwd: tmpDir(),
    ...overrides,
  };
}

/** Collects what a command writes. */
export function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
    out: () => out.join(""),
    err: () => err.join(""),
    lines: () => out.join("").split("\n").filter(Boolean),
  };
}

/**
 * Writes `run/service.json` + `run/token` for a fake service listening on `port`, as the
 * real one would. Used to simulate stale files and a service with a different API version.
 */
export function writeRuntimeFiles(
  dataDir: string,
  info: { pid: number; port: number },
  token = "t".repeat(43),
): void {
  const run = join(dataDir, "run");
  mkdirSync(run, { recursive: true });
  writeFileSync(
    join(run, "service.json"),
    JSON.stringify({
      ...info,
      apiVersion: 1,
      serviceVersion: "0.0.0",
      startedAt: "2026-10-20T16:00:00.000Z",
    }),
  );
  writeFileSync(join(run, "token"), token, { mode: 0o600 });
}

/** A fake service: `/health/ping` answers "ok" and `health.get` reports `apiVersion`. */
export async function startFakeService(apiVersion: number): Promise<number> {
  const server = createServer((req, res) => {
    if (req.url === "/health/ping") {
      res.end("ok");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        result: {
          apiVersion,
          serviceVersion: "9.9.9",
          startedAt: "2026-10-20T16:00:00.000Z",
          dataDir: "/x",
          secretStore: "keychain",
          connectors: [],
        },
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no address");
  return addr.port;
}

/** A pid that is guaranteed to be dead: a child that has already exited. */
export function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  if (typeof r.pid !== "number") throw new Error("spawn failed");
  return r.pid;
}
