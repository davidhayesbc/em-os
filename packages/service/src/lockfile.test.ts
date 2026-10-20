import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AlreadyRunningError, acquireLock, isPidAlive, parseLockPid } from "./lockfile.js";
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
  it("creates the lock file containing { pid, startedAt } as JSON", async () => {
    const file = join(tmpDir(), "service.lock");
    const lock = await acquireLock(file, { now: () => Date.parse("2026-10-20T16:00:00.000Z") });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      pid: process.pid,
      startedAt: "2026-10-20T16:00:00.000Z",
    });
    lock.release();
    expect(existsSync(file)).toBe(false);
  });

  it("still honours a live lock in the old pid-only format", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, "4242\n");
    await expect(acquireLock(file, { isAlive: (p) => p === 4242 })).rejects.toThrow(
      /already running \(pid 4242\)/,
    );
  });

  it("reclaims a lock older than system boot even when its pid is alive (recycled pid)", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, JSON.stringify({ pid: 4242, startedAt: "2026-10-19T08:00:00.000Z" }));
    const now = Date.parse("2026-10-20T16:00:00.000Z");
    const uptimeSec = 3600; // booted at 15:00
    utimesSync(file, new Date(now - 2 * 3600_000), new Date(now - 2 * 3600_000)); // 14:00
    const lock = await acquireLock(file, {
      pid: 1001,
      isAlive: () => true, // 4242 now belongs to some unrelated process
      now: () => now,
      uptimeSec: () => uptimeSec,
    });
    expect(parseLockPid(readFileSync(file, "utf8"))).toBe(1001);
    lock.release();
  });

  it("reclaims an old-format lock older than boot too", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, "4242\n");
    const now = Date.parse("2026-10-20T16:00:00.000Z");
    utimesSync(file, new Date(now - 7200_000), new Date(now - 7200_000));
    const lock = await acquireLock(file, {
      pid: 1001,
      isAlive: () => true,
      now: () => now,
      uptimeSec: () => 3600,
    });
    expect(parseLockPid(readFileSync(file, "utf8"))).toBe(1001);
    lock.release();
  });

  it("keeps a lock taken after boot whose pid is alive", async () => {
    const file = join(tmpDir(), "service.lock");
    writeFileSync(file, JSON.stringify({ pid: 4242, startedAt: "2026-10-20T15:30:00.000Z" }));
    const now = Date.parse("2026-10-20T16:00:00.000Z");
    utimesSync(file, new Date(now - 1800_000), new Date(now - 1800_000)); // 15:30, after boot
    await expect(
      acquireLock(file, {
        pid: 1001,
        isAlive: () => true,
        now: () => now,
        uptimeSec: () => 3600,
      }),
    ).rejects.toBeInstanceOf(AlreadyRunningError);
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
    expect(parseLockPid(readFileSync(file, "utf8"))).toBe(process.pid);
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
    expect(parseLockPid(readFileSync(file, "utf8"))).toBe(process.pid);
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

describe("parseLockPid", () => {
  it("reads the JSON format and the old pid-only format", () => {
    expect(parseLockPid('{"pid":123,"startedAt":"2026-10-20T16:00:00.000Z"}\n')).toBe(123);
    expect(parseLockPid("123\n")).toBe(123);
    expect(parseLockPid(" 77 ")).toBe(77);
  });

  it.each(["", "abc", "{", '{"pid":"12"}', '{"pid":-1}', '{"pid":1.5}', "[1]", "null", "12abc"])(
    "rejects %j",
    (t) => {
      expect(parseLockPid(t)).toBeNull();
    },
  );
});
