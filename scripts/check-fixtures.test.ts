import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scan } from "./check-fixtures.mjs";

// This file is itself scanned (check-fixtures covers *.test.ts), yet its data must trip the
// scanner. So the tell-tale characters are spliced in at runtime and the source stays clean.
const AT = "@";
const SL = "//";
const T0 = "T0";
const XOX = "xox";

describe("scan", () => {
  it("rejects non-reserved email domains", () => {
    expect(scan(`a${AT}acme.io`)).toEqual([{ rule: "email-domain", match: `a${AT}acme.io` }]);
  });

  it("allows example domains", () => {
    expect(scan("sam@example.com https://docs.example.org/x")).toEqual([]);
  });

  it("allows all reserved example TLDs for emails", () => {
    expect(scan("a@example.com b@example.org c@example.net")).toEqual([]);
  });

  it("does not accept look-alike email domains", () => {
    expect(scan(`a${AT}example.com.evil.io`)[0]?.rule).toBe("email-domain");
    expect(scan(`a${AT}notexample.com`)[0]?.rule).toBe("email-domain");
    expect(scan(`a${AT}example.io`)[0]?.rule).toBe("email-domain");
  });

  it("rejects non-reserved URL hosts", () => {
    expect(scan(`see https:${SL}acme.io/docs for more`)).toEqual([
      { rule: "url-host", match: `https:${SL}acme.io` },
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
    expect(scan(`https:${SL}example.com.evil.io/x`)[0]?.rule).toBe("url-host");
    expect(scan(`https:${SL}notexample.com/x`)[0]?.rule).toBe("url-host");
    expect(scan(`https:${SL}example.com${AT}evil.io/x`)[0]).toEqual({
      rule: "url-host",
      match: `https:${SL}example.com${AT}evil.io`,
    });
  });

  it("ignores trailing punctuation after a URL", () => {
    expect(scan("(see https://example.com/x), and https://example.org.")).toEqual([]);
  });

  it("rejects Slack-style workspace ids", () => {
    expect(scan(`${T0}2ABCDEF`)[0]?.rule).toBe("workspace-id");
    expect(scan(`${T0}2ABCDEF`)).toEqual([{ rule: "workspace-id", match: `${T0}2ABCDEF` }]);
  });

  it("ignores ids outside the workspace-id shape", () => {
    expect(scan("T02ABC T02ABCDEFGHIJK AT02ABCDEF T12ABCDEF")).toEqual([]);
  });

  it("rejects Slack tokens without echoing the secret", () => {
    for (const prefix of [`${XOX}a-`, `${XOX}b-`, `${XOX}p-`, `${XOX}r-`]) {
      expect(scan(`token=${prefix}1234-abcd`)).toEqual([{ rule: "slack-token", match: prefix }]);
    }
    expect(scan("xoxs-1234")).toEqual([]);
  });

  it("returns findings in order of appearance and is deterministic", () => {
    const text = `${XOX}b-1 then a${AT}acme.io then ${T0}2ABCDEF then https:${SL}acme.io/x`;
    const expected = [
      { rule: "slack-token", match: `${XOX}b-` },
      { rule: "email-domain", match: `a${AT}acme.io` },
      { rule: "workspace-id", match: `${T0}2ABCDEF` },
      { rule: "url-host", match: `https:${SL}acme.io` },
    ];
    expect(scan(text)).toEqual(expected);
    expect(scan(text)).toEqual(expected);
  });

  it("allows loopback URLs whose port is a template placeholder", () => {
    expect(scan(`http:${SL}127.0.0.1:\${svc.port}/rpc`)).toEqual([]);
    expect(scan(`http:${SL}localhost:\${port}`)).toEqual([]);
    // ...but not a placeholder host, nor a real host before the placeholder.
    expect(scan(`https:${SL}acme.io:\${port}/x`)[0]?.rule).toBe("url-host");
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
    writeFileSync(join(dir, "fixtures", "nested", "bad.md"), `fine\nping bob${AT}acme.io now\n`);
    const { code, out } = run("fixtures");
    expect(code).toBe(1);
    expect(out).toContain(`fixtures/nested/bad.md:2 email-domain bob${AT}acme.io`);
    expect(out).not.toContain("ok.md");
  });

  it("exits 0 for clean fixtures", () => {
    mkdirSync(join(dir, "fixtures"));
    writeFileSync(join(dir, "fixtures", "ok.md"), "sam@example.com\n");
    expect(run("fixtures").code).toBe(0);
  });

  it("with no argument scans fixtures/ and packages/*/fixtures/", () => {
    mkdirSync(join(dir, "packages", "core", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "packages", "core", "fixtures", "bad.json"), `{"a":"x${AT}acme.io"}\n`);
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain(`packages/core/fixtures/bad.json:1 email-domain x${AT}acme.io`);
  });

  it("with no argument also scans *.test.ts(x) under packages/ and scripts/", () => {
    mkdirSync(join(dir, "packages", "core", "src"), { recursive: true });
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "packages", "core", "src", "a.test.ts"), `"bob${AT}acme.io"\n`);
    writeFileSync(join(dir, "packages", "core", "src", "b.test.tsx"), `"https:${SL}acme.io"\n`);
    writeFileSync(join(dir, "scripts", "c.test.ts"), `"${T0}2ABCDEF"\n`);
    writeFileSync(join(dir, "packages", "core", "src", "not-a-test.ts"), `"bob${AT}acme.io"\n`);
    const { code, out } = run();
    expect(code).toBe(1);
    expect(out).toContain(`packages/core/src/a.test.ts:1 email-domain bob${AT}acme.io`);
    expect(out).toContain(`packages/core/src/b.test.tsx:1 url-host https:${SL}acme.io`);
    expect(out).toContain(`scripts/c.test.ts:1 workspace-id ${T0}2ABCDEF`);
    expect(out).not.toContain("not-a-test.ts");
  });

  it("skips node_modules and dist when scanning test files", () => {
    for (const sub of ["node_modules", "dist"]) {
      mkdirSync(join(dir, "packages", "core", sub), { recursive: true });
      writeFileSync(join(dir, "packages", "core", sub, "x.test.ts"), `"bob${AT}acme.io"\n`);
    }
    mkdirSync(join(dir, "packages", "core", "src"), { recursive: true });
    writeFileSync(join(dir, "packages", "core", "src", "ok.test.ts"), '"sam@example.com"\n');
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain("check-fixtures: ok");
  });

  it("an explicit directory scans only that directory", () => {
    mkdirSync(join(dir, "fixtures"));
    writeFileSync(join(dir, "fixtures", "ok.md"), "sam@example.com\n");
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "c.test.ts"), `"bob${AT}acme.io"\n`);
    expect(run("fixtures").code).toBe(0);
  });

  it.skipIf(process.platform === "win32")(
    "still fails (exit 1) when invoked through a symlinked path",
    () => {
      mkdirSync(join(dir, "fixtures"));
      writeFileSync(join(dir, "fixtures", "bad.md"), `bob${AT}acme.io\n`);
      const link = join(dir, "linked-check-fixtures.mjs");
      symlinkSync(script, link);
      const result = spawnSync(process.execPath, [link, "fixtures"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain(`fixtures/bad.md:1 email-domain bob${AT}acme.io`);
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
