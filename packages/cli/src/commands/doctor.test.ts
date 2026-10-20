import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
import { createDoctorCommand } from "./doctor.js";

afterEach(cleanup);

const keychainOk = async () => {};

async function doctor(
  dataDir: string,
  args: string[] = [],
  keychainCheck: () => Promise<void> = keychainOk,
) {
  const cmd = createDoctorCommand({ cli: testEnv(dataDir), keychainCheck });
  const cap = capture();
  const code = await cmd.run(args, cap.io);
  return { code, lines: cap.lines(), out: cap.out(), err: cap.err() };
}

const LABELS = [
  "data dir",
  "not in git checkout",
  "service reachable",
  "api version",
  "keychain readable",
];

describe("emos doctor", () => {
  it("against a running service: every check passes, one line per check, exit 0", async () => {
    const svc = await startTestService();
    const { code, lines } = await doctor(svc.dataDir);
    expect(lines).toHaveLength(5);
    lines.forEach((line, i) => {
      expect(line.startsWith(`✓ ${LABELS[i]}`)).toBe(true);
    });
    expect(lines[0]).toContain(svc.dataDir);
    expect(code).toBe(0);
  });

  it("with no service: service reachable and api version fail, exit 1", async () => {
    const dataDir = tmpDir();
    const { code, lines } = await doctor(dataDir);
    expect(lines[0]).toContain("✓ data dir");
    expect(lines[1]).toBe("✓ not in git checkout");
    expect(lines[2]).toBe("✗ service reachable — not running (no run/service.json)");
    expect(lines[3]).toBe("✗ api version — service not reachable");
    expect(lines[4]).toBe("✓ keychain readable");
    expect(code).toBe(1);
  });

  it("a stale service.json (dead pid) reads as unreachable", async () => {
    const dataDir = tmpDir();
    writeRuntimeFiles(dataDir, { pid: deadPid(), port: 1 });
    const { code, lines } = await doctor(dataDir);
    expect(lines[2]).toMatch(
      /^✗ service reachable — stale run\/service\.json \(pid \d+ is not running\)$/,
    );
    expect(code).toBe(1);
  });

  it("a live pid with nothing listening reads as unreachable", async () => {
    const svc = await startTestService();
    const dataDir = tmpDir();
    const port = svc.port;
    await svc.stop(); // the port is now free
    writeRuntimeFiles(dataDir, { pid: process.pid, port });
    const { code, lines } = await doctor(dataDir);
    expect(lines[2]).toBe(`✗ service reachable — no response on port ${port}`);
    expect(code).toBe(1);
  });

  it("reports an API version mismatch", async () => {
    const dataDir = tmpDir();
    const port = await startFakeService(99);
    writeRuntimeFiles(dataDir, { pid: process.pid, port });
    const { code, lines } = await doctor(dataDir);
    expect(lines[2]).toBe("✓ service reachable");
    expect(lines[3]).toBe("✗ api version — service speaks 99, this cli expects 1");
    expect(code).toBe(1);
  });

  it("reports a missing data dir", async () => {
    const { code, lines } = await doctor(join(tmpDir(), "nope"));
    expect(lines[0]).toMatch(/^✗ data dir — .*does not exist/);
    expect(code).toBe(1);
  });

  it("reports a data dir inside a git checkout", async () => {
    const repo = tmpDir();
    mkdirSync(join(repo, ".git"));
    const dataDir = join(repo, "data");
    mkdirSync(dataDir);
    const { code, lines } = await doctor(dataDir);
    expect(lines[1]).toMatch(/^✗ not in git checkout — .*git checkout/);
    expect(code).toBe(1);
  });

  it("reports a keychain failure with its reason", async () => {
    const svc = await startTestService();
    const { code, lines } = await doctor(svc.dataDir, [], async () => {
      throw new Error("keychain locked");
    });
    expect(lines[4]).toBe("✗ keychain readable — keychain locked");
    expect(code).toBe(1);
  });

  it("honours --data-dir over the environment", async () => {
    const svc = await startTestService();
    const cmd = createDoctorCommand({
      cli: testEnv(join(tmpDir(), "wrong")),
      keychainCheck: keychainOk,
    });
    const cap = capture();
    const code = await cmd.run(["--data-dir", svc.dataDir], cap.io);
    expect(code).toBe(0);
  });

  it("an unknown option is a usage error (exit 2)", async () => {
    const { code, err } = await doctor(tmpDir(), ["--bogus"]);
    expect(code).toBe(2);
    expect(err).toContain("Usage: emos doctor");
  });
});
