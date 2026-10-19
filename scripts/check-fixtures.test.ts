import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scan } from "./check-fixtures.mjs";

describe("scan", () => {
  it("rejects non-reserved email domains", () => {
    expect(scan("a@acme.io")).toEqual([{ rule: "email-domain", match: "a@acme.io" }]);
  });

  it("allows example domains", () => {
    expect(scan("sam@example.com https://docs.example.org/x")).toEqual([]);
  });

  it("allows all reserved example TLDs for emails", () => {
    expect(scan("a@example.com b@example.org c@example.net")).toEqual([]);
  });

  it("does not accept look-alike email domains", () => {
    expect(scan("a@example.com.evil.io")[0]?.rule).toBe("email-domain");
    expect(scan("a@notexample.com")[0]?.rule).toBe("email-domain");
    expect(scan("a@example.io")[0]?.rule).toBe("email-domain");
  });

  it("rejects non-reserved URL hosts", () => {
    expect(scan("see https://acme.io/docs for more")).toEqual([
      { rule: "url-host", match: "https://acme.io" },
    ]);
  });

  it("allows example subdomains, localhost and 127.0.0.1 URLs", () => {
    const text = [
      "https://example.com",
      "http://a.b.example.net/path?q=1",
      "http://localhost:3000/health/ping",
      "http://127.0.0.1:8080",
    ].join("\n");
    expect(scan(text)).toEqual([]);
  });

  it("does not accept look-alike URL hosts", () => {
    expect(scan("https://example.com.evil.io/x")[0]?.rule).toBe("url-host");
    expect(scan("https://notexample.com/x")[0]?.rule).toBe("url-host");
    expect(scan("https://example.com@evil.io/x")[0]).toEqual({
      rule: "url-host",
      match: "https://example.com@evil.io",
    });
  });

  it("ignores trailing punctuation after a URL", () => {
    expect(scan("(see https://example.com/x), and https://example.org.")).toEqual([]);
  });

  it("rejects Slack-style workspace ids", () => {
    expect(scan("T02ABCDEF")[0]?.rule).toBe("workspace-id");
    expect(scan("T02ABCDEF")).toEqual([{ rule: "workspace-id", match: "T02ABCDEF" }]);
  });

  it("ignores ids outside the workspace-id shape", () => {
    expect(scan("T02ABC T02ABCDEFGHIJK AT02ABCDEF T12ABCDEF")).toEqual([]);
  });

  it("rejects Slack tokens without echoing the secret", () => {
    for (const prefix of ["xoxa-", "xoxb-", "xoxp-", "xoxr-"]) {
      expect(scan(`token=${prefix}1234-abcd`)).toEqual([{ rule: "slack-token", match: prefix }]);
    }
    expect(scan("xoxs-1234")).toEqual([]);
  });

  it("returns findings in order of appearance and is deterministic", () => {
    const text = "xoxb-1 then a@acme.io then T02ABCDEF then https://acme.io/x";
    const expected = [
      { rule: "slack-token", match: "xoxb-" },
      { rule: "email-domain", match: "a@acme.io" },
      { rule: "workspace-id", match: "T02ABCDEF" },
      { rule: "url-host", match: "https://acme.io" },
    ];
    expect(scan(text)).toEqual(expected);
    expect(scan(text)).toEqual(expected);
  });

  it("returns nothing for clean text", () => {
    expect(scan("")).toEqual([]);
    expect(scan("Synthetic Sam met Alex on 2026-10-20.")).toEqual([]);
  });
});

describe("check-fixtures CLI", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "check-fixtures.mjs");
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "check-fixtures-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(...args: string[]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    return { code: result.status, out: result.stdout, err: result.stderr };
  }

  it("exits 1 and prints file:line rule match for a violating fixture", () => {
    mkdirSync(join(dir, "fixtures", "nested"), { recursive: true });
    writeFileSync(join(dir, "fixtures", "ok.md"), "sam@example.com\n");
    writeFileSync(join(dir, "fixtures", "nested", "bad.md"), "fine\nping bob@acme.io now\n");
    const { code, out } = run("fixtures");
    expect(code).toBe(1);
    expect(out).toContain("fixtures/nested/bad.md:2 email-domain bob@acme.io");
    expect(out).not.toContain("ok.md");
  });

  it("exits 0 for clean fixtures", () => {
    mkdirSync(join(dir, "fixtures"));
    writeFileSync(join(dir, "fixtures", "ok.md"), "sam@example.com\n");
    expect(run("fixtures").code).toBe(0);
  });

  it("with no argument scans fixtures/ and packages/*/fixtures/", () => {
    mkdirSync(join(dir, "packages", "core", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "packages", "core", "fixtures", "bad.json"), '{"a":"x@acme.io"}\n');
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain("packages/core/fixtures/bad.json:1 email-domain x@acme.io");
  });

  it.skipIf(process.platform === "win32")(
    "still fails (exit 1) when invoked through a symlinked path",
    () => {
      mkdirSync(join(dir, "fixtures"));
      writeFileSync(join(dir, "fixtures", "bad.md"), "bob@acme.io\n");
      const link = join(dir, "linked-check-fixtures.mjs");
      symlinkSync(script, link);
      const result = spawnSync(process.execPath, [link, "fixtures"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("fixtures/bad.md:1 email-domain bob@acme.io");
    },
  );

  it("exits 0 with a note when the target directory does not exist", () => {
    const explicit = run("fixtures");
    expect(explicit.code).toBe(0);
    expect(explicit.out).toMatch(/no fixtures/i);
    const implicit = run();
    expect(implicit.code).toBe(0);
    expect(implicit.out).toMatch(/no fixtures/i);
  });
});
