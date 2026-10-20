import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { capture, cleanup, startTestService, testEnv, tmpDir } from "../test-helpers.js";
import { createBackupCommand } from "./backup.js";

afterEach(cleanup);

async function backup(dataDir: string, args: string[], cwd?: string) {
  const cmd = createBackupCommand({ cli: testEnv(dataDir, cwd ? { cwd } : {}) });
  const cap = capture();
  const code = await cmd.run(args, cap.io);
  return { code, out: cap.out(), err: cap.err() };
}

describe("emos backup", () => {
  it("writes a database copy that openDb can open", async () => {
    const svc = await startTestService();
    const dest = join(tmpDir(), "out", "copy.db");
    const { code, out } = await backup(svc.dataDir, [dest]);
    expect(code).toBe(0);
    expect(out).toContain(dest);
    expect(statSync(dest).size).toBeGreaterThan(0);
    const db = openDb(dest);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get<{ n: number }>()?.n,
    ).toBeGreaterThan(0);
    db.close();
  });

  it("resolves a relative destination against the working directory", async () => {
    const svc = await startTestService();
    const cwd = tmpDir();
    const { code } = await backup(svc.dataDir, ["rel.db"], cwd);
    expect(code).toBe(0);
    expect(existsSync(join(cwd, "rel.db"))).toBe(true);
  });

  it("refuses to overwrite an existing file (exit 1, file untouched)", async () => {
    const svc = await startTestService();
    const dest = join(tmpDir(), "exists.db");
    writeFileSync(dest, "keep me");
    const { code, err } = await backup(svc.dataDir, [dest]);
    expect(code).toBe(1);
    expect(err).toContain("already exists");
    expect(statSync(dest).size).toBe("keep me".length);
  });

  it("refuses a destination inside a git checkout", async () => {
    const svc = await startTestService();
    const repo = tmpDir();
    mkdirSync(join(repo, ".git"));
    const { code, err } = await backup(svc.dataDir, [join(repo, "copy.db")]);
    expect(code).toBe(1);
    expect(err).toContain("git checkout");
  });

  it("with no service running: clear message, exit 1", async () => {
    const { code, err } = await backup(tmpDir(), [join(tmpDir(), "copy.db")]);
    expect(code).toBe(1);
    expect(err).toContain("service is not running");
    expect(err).toContain("emos service start");
  });

  it("needs exactly one destination (usage, exit 2)", async () => {
    const svc = await startTestService();
    for (const args of [[], ["a.db", "b.db"], ["--bogus", "a.db"]]) {
      const { code, err } = await backup(svc.dataDir, args);
      expect(code).toBe(2);
      expect(err).toContain("Usage: emos backup");
    }
  });

  it("honours --data-dir", async () => {
    const svc = await startTestService();
    const cmd = createBackupCommand({ cli: testEnv(join(tmpDir(), "wrong")) });
    const cap = capture();
    const dest = join(tmpDir(), "copy.db");
    const code = await cmd.run(["--data-dir", svc.dataDir, dest], cap.io);
    expect(code).toBe(0);
    expect(existsSync(dest)).toBe(true);
  });
});
