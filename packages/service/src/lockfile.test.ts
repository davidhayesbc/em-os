import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AlreadyRunningError, acquireLock, isPidAlive } from "./lockfile.js";
import { cleanup, tmpDir } from "./test-helpers.js";

afterEach(cleanup);

/** The pid of a process that has already exited. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  if (typeof r.pid !== "number") throw new Error("spawn failed");
  return r.pid;
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("isPidAlive", () => {
  it("is true for this process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("is false for an exited process", () => {
    expect(isPidAlive(deadPid())).toBe(false);
  });

  it("treats ESRCH as dead and EPERM as alive (another user's process)", () => {
    expect(
      isPidAlive(42, () => {
        throw errno("ESRCH");
      }),
    ).toBe(false);
    expect(
      isPidAlive(42, () => {
        throw errno("EPERM");
      }),
    ).toBe(true);
  });

  it("rejects non-positive and non-integer pids as dead", () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(isPidAlive(pid)).toBe(false);
  });
});

describe("acquireLock", () => {
  it("creates the lock file containing the pid", async () => {
    const file = join(tmpDir(), "service.lock");
    const lock = await acquireLock(file);
    expect(readFileSync(file, "utf8").trim()).toBe(String(process.pid));
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it("refuses a lock held by a live pid with 'already running'", async () => {
    const file = join(tmpDir(), "service.lock");
    const lock = await acquireLock(file);
    const second = acquireLock(file);
    await expect(second).rejects.toBeInstanceOf(AlreadyRunningError);
    await expect(acquireLock(file)).rejects.toThrow(/already running/);
    lock.release();
  });

  it("reclaims a stale lock whose pid is dead", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, String(deadPid()));
    const lock = await acquireLock(file);
    expect(readFileSync(file, "utf8").trim()).toBe(String(process.pid));
    lock.release();
  });

  it("treats a lock whose owner gets EPERM as alive", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, "4242");
    await expect(acquireLock(file, { isAlive: () => true })).rejects.toThrow(/already running/);
    expect(readFileSync(file, "utf8")).toBe("4242");
  });

  it("reclaims a lock with unreadable contents once the partial-write grace period passes", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, "not a pid");
    const lock = await acquireLock(file, { partialWriteGraceMs: 10 });
    expect(readFileSync(file, "utf8").trim()).toBe(String(process.pid));
    lock.release();
  });

  it("only one of two concurrent acquirers of a stale lock wins", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, String(deadPid()));
    // Distinct fake pids, both "alive" unless they are the dead one.
    const alive = (pid: number) => pid === 1001 || pid === 1002;
    const results = await Promise.allSettled([
      acquireLock(file, { pid: 1001, isAlive: alive }),
      acquireLock(file, { pid: 1002, isAlive: alive }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("release() leaves a lock that now belongs to someone else", async () => {
    const file = join(tmpDir(), "service.lock");
    const lock = await acquireLock(file);
    writeFileSync(file, "4242"); // e.g. a newer instance reclaimed it
    lock.release();
    expect(readFileSync(file, "utf8")).toBe("4242");
  });

  it("release() is idempotent", async () => {
    const file = join(tmpDir(), "service.lock");
    const lock = await acquireLock(file);
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });
});
