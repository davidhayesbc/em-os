import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimePaths } from "@emos/service";
import {
  assertNotInGitCheckout as storeAssertNotInGitCheckout,
  resolveDataDir as storeResolveDataDir,
} from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNotInGitCheckout,
  readServiceInfo,
  readToken,
  resolveDataDir,
  resolveWebviewDist,
  runtimeFiles,
} from "./runtime.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "emos ext zoë-"));
  dirs.push(d);
  return d;
}

describe("runtime paths (duplicated to keep node:sqlite and the keychain out of the extension)", () => {
  it("resolveDataDir matches @emos/store-sqlite on every platform", () => {
    const cases: Array<[NodeJS.ProcessEnv, NodeJS.Platform, string]> = [
      [{}, "darwin", "/Users/zoë"],
      [{ EMOS_DATA_DIR: "/tmp/x y" }, "darwin", "/Users/q"],
      [{ LOCALAPPDATA: "C:\\Users\\Zoë Q\\AppData\\Local" }, "win32", "C:\\Users\\Zoë Q"],
      [{}, "win32", "C:\\Users\\Q"],
      [{ XDG_DATA_HOME: "/xdg" }, "linux", "/home/q"],
      [{ XDG_DATA_HOME: "relative" }, "linux", "/home/q"],
      [{}, "linux", "/home/q"],
    ];
    for (const [env, platform, home] of cases) {
      expect(resolveDataDir(env, platform, home)).toBe(storeResolveDataDir(env, platform, home));
    }
  });

  it("assertNotInGitCheckout matches @emos/store-sqlite", () => {
    const repo = (p: string) => p === "/w/repo/.git" || p === "C:\\w\\repo\\.git";
    for (const dir of ["/w/repo/data", "/w/other", "C:\\w\\repo\\EM OS", "C:\\w\\x"]) {
      let ours: unknown = null;
      let theirs: unknown = null;
      try {
        assertNotInGitCheckout(dir, repo);
      } catch (e) {
        ours = (e as Error).message;
      }
      try {
        storeAssertNotInGitCheckout(dir, repo);
      } catch (e) {
        theirs = (e as Error).message;
      }
      expect(ours).toBe(theirs);
    }
    expect(() => assertNotInGitCheckout("/w/repo/data", repo)).toThrow(/inside a git checkout/);
  });

  it("runtimeFiles matches @emos/service's runtimePaths", () => {
    const d = join(tmp(), "d");
    expect(runtimeFiles(d)).toEqual(runtimePaths(d));
  });

  it("readServiceInfo: null when absent, 'invalid' when malformed, the info otherwise", () => {
    const d = tmp();
    expect(readServiceInfo(d)).toBeNull();
    mkdirSync(join(d, "run"));
    writeFileSync(join(d, "run", "service.json"), "{nope");
    expect(readServiceInfo(d)).toBe("invalid");
    writeFileSync(join(d, "run", "service.json"), JSON.stringify({ pid: 1, port: 0 }));
    expect(readServiceInfo(d)).toBe("invalid");
    const info = {
      pid: 12,
      port: 4000,
      apiVersion: 1,
      serviceVersion: "0.0.0",
      startedAt: "2026-10-20T16:00:00.000Z",
    };
    writeFileSync(join(d, "run", "service.json"), JSON.stringify(info));
    expect(readServiceInfo(d)).toEqual(info);
  });

  it("readToken trims, and is null when missing or empty", () => {
    const d = tmp();
    expect(readToken(d)).toBeNull();
    mkdirSync(join(d, "run"));
    writeFileSync(join(d, "run", "token"), "  \n");
    expect(readToken(d)).toBeNull();
    writeFileSync(join(d, "run", "token"), `${"t".repeat(43)}\n`);
    expect(readToken(d)).toBe("t".repeat(43));
  });
});

describe("resolveWebviewDist", () => {
  it("prefers the packaged copy under dist/webview", () => {
    const ext = tmp();
    mkdirSync(join(ext, "dist", "webview"), { recursive: true });
    writeFileSync(join(ext, "dist", "webview", "dashboard.js"), "");
    expect(resolveWebviewDist(ext)).toBe(join(ext, "dist", "webview"));
  });

  it("falls back to the @emos/webview package's dist in development", () => {
    const dir = resolveWebviewDist(join(import.meta.dirname, ".."));
    expect(dir).toMatch(/webview[/\\]dist$/);
  });

  it("throws a clear error when the assets were never built", () => {
    expect(() => resolveWebviewDist(tmp())).toThrow(/webview assets not found/);
  });
});
