import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openServiceLog, readLogTail, serviceLogPath, withLogTail } from "./service-log.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "emos cli log zoë-"));
  dirs.push(d);
  return d;
}

describe("openServiceLog", () => {
  it("creates logs/ (0700) and an append-only service.log (0600)", () => {
    const d = join(tmp(), "data");
    const log = openServiceLog(d);
    writeSync(log.fd, "one\n");
    closeSync(log.fd);
    const again = openServiceLog(d);
    expect(again.offset).toBe(4);
    writeSync(again.fd, "two\n");
    closeSync(again.fd);
    expect(readFileSync(serviceLogPath(d), "utf8")).toBe("one\ntwo\n");
    if (process.platform !== "win32") {
      expect(statSync(join(d, "logs")).mode & 0o777).toBe(0o700);
      expect(statSync(serviceLogPath(d)).mode & 0o777).toBe(0o600);
    }
  });

  it("rotates a log over the cap to service.log.1, replacing an older one", () => {
    const d = tmp();
    const first = openServiceLog(d);
    closeSync(first.fd);
    writeFileSync(`${first.path}.1`, "ancient\n");
    writeFileSync(first.path, "x".repeat(101));
    const log = openServiceLog(d, 100);
    closeSync(log.fd);
    expect(log.offset).toBe(0);
    expect(readFileSync(`${log.path}.1`, "utf8")).toBe("x".repeat(101));
    expect(readFileSync(log.path, "utf8")).toBe("");
  });

  it("keeps a log at or under the cap", () => {
    const d = tmp();
    const first = openServiceLog(d);
    closeSync(first.fd);
    writeFileSync(first.path, "x".repeat(100));
    closeSync(openServiceLog(d, 100).fd);
    expect(existsSync(`${first.path}.1`)).toBe(false);
  });
});

describe("readLogTail", () => {
  it("returns the last 20 non-empty lines written since the offset", () => {
    const d = tmp();
    const log = openServiceLog(d);
    closeSync(log.fd);
    appendFileSync(log.path, "old run\n");
    const offset = statSync(log.path).size;
    appendFileSync(log.path, Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
    appendFileSync(log.path, "\n\n");
    const tail = readLogTail(log.path, offset);
    expect(tail).toHaveLength(20);
    expect(tail[0]).toBe("line 10");
    expect(tail[19]).toBe("line 29");
    expect(readLogTail(log.path, offset, 2)).toEqual(["line 28", "line 29"]);
  });

  it("is empty for a missing file or nothing new", () => {
    const d = tmp();
    expect(readLogTail(join(d, "nope.log"))).toEqual([]);
    writeFileSync(join(d, "a.log"), "x\n");
    expect(readLogTail(join(d, "a.log"), 2)).toEqual([]);
  });

  it("withLogTail appends the lines, or says there was no output", () => {
    const d = tmp();
    const path = join(d, "a.log");
    writeFileSync(path, "emos-service: already running\n");
    expect(withLogTail("exited (code 1)", { path, offset: 0 })).toBe(
      `exited (code 1). Last log lines (${path}):\nemos-service: already running`,
    );
    expect(withLogTail("exited", { path, offset: 1000 })).toBe(`exited (no output in ${path})`);
  });
});

describe("duplicate of the extension's service-log.ts", () => {
  it("has the same code apart from the header comment", () => {
    const body = (p: string) =>
      readFileSync(p, "utf8")
        .split("\n")
        .filter((l) => !l.startsWith("//"))
        .join("\n");
    const ours = join(import.meta.dirname, "service-log.ts");
    const theirs = join(import.meta.dirname, "..", "..", "extension", "src", "service-log.ts");
    expect(body(ours)).toBe(body(theirs));
  });
});
