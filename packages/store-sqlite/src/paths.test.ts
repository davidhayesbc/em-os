import { describe, expect, it } from "vitest";
import { assertNotInGitCheckout, dataLayout, resolveDataDir } from "./paths.js";

describe("resolveDataDir", () => {
  it("resolves platform data dirs", () => {
    expect(resolveDataDir({}, "darwin", "/Users/zoë q")).toBe(
      "/Users/zoë q/Library/Application Support/EM OS",
    );
    expect(
      resolveDataDir(
        { LOCALAPPDATA: "C:\\Users\\Zoë Q\\AppData\\Local" },
        "win32",
        "C:\\Users\\Zoë Q",
      ),
    ).toBe("C:\\Users\\Zoë Q\\AppData\\Local\\EM OS");
  });

  it("falls back to <home>\\AppData\\Local on Windows when LOCALAPPDATA is unset", () => {
    expect(resolveDataDir({}, "win32", "C:\\Users\\Zoë Q")).toBe(
      "C:\\Users\\Zoë Q\\AppData\\Local\\EM OS",
    );
  });

  it("uses XDG_DATA_HOME on Linux, else ~/.local/share", () => {
    expect(resolveDataDir({ XDG_DATA_HOME: "/data/xdg" }, "linux", "/home/a")).toBe(
      "/data/xdg/em-os",
    );
    expect(resolveDataDir({}, "linux", "/home/a")).toBe("/home/a/.local/share/em-os");
    // The XDG spec says relative values are invalid and must be ignored.
    expect(resolveDataDir({ XDG_DATA_HOME: "rel/dir" }, "linux", "/home/a")).toBe(
      "/home/a/.local/share/em-os",
    );
  });

  it("EMOS_DATA_DIR overrides the platform default", () => {
    expect(resolveDataDir({ EMOS_DATA_DIR: "/tmp/x" }, "darwin", "/Users/a")).toBe("/tmp/x");
    expect(resolveDataDir({ EMOS_DATA_DIR: "D:\\emos" }, "win32", "C:\\Users\\a")).toBe("D:\\emos");
  });

  it("ignores an empty EMOS_DATA_DIR", () => {
    expect(resolveDataDir({ EMOS_DATA_DIR: "" }, "darwin", "/Users/a")).toBe(
      "/Users/a/Library/Application Support/EM OS",
    );
  });
});

describe("assertNotInGitCheckout", () => {
  it("refuses a data dir inside a git checkout", () => {
    expect(() => assertNotInGitCheckout("/r/proj/data", (p) => p === "/r/proj/.git")).toThrow(
      /inside a git checkout/,
    );
  });

  it("names the offending directory in the message", () => {
    expect(() => assertNotInGitCheckout("/r/proj/data", (p) => p === "/r/proj/.git")).toThrow(
      "EM OS data directory is inside a git checkout: /r/proj/data",
    );
  });

  it("refuses when the data dir itself is a checkout root", () => {
    expect(() => assertNotInGitCheckout("/r/proj", (p) => p === "/r/proj/.git")).toThrow(
      /inside a git checkout/,
    );
  });

  it("checks every parent up to the filesystem root", () => {
    const seen: string[] = [];
    assertNotInGitCheckout("/a/b/c", (p) => {
      seen.push(p);
      return false;
    });
    expect(seen).toEqual(["/a/b/c/.git", "/a/b/.git", "/a/.git", "/.git"]);
  });

  it("walks Windows paths, including ones with spaces and Unicode", () => {
    const dir = "C:\\Users\\Zoë Q\\AppData\\Local\\EM OS";
    expect(() => assertNotInGitCheckout(dir, () => false)).not.toThrow();
    expect(() => assertNotInGitCheckout(dir, (p) => p === "C:\\Users\\Zoë Q\\.git")).toThrow(
      /inside a git checkout/,
    );
    const seen: string[] = [];
    assertNotInGitCheckout("C:\\a\\b", (p) => {
      seen.push(p);
      return false;
    });
    expect(seen).toEqual(["C:\\a\\b\\.git", "C:\\a\\.git", "C:\\.git"]);
  });

  it("accepts a normal data dir with spaces and Unicode", () => {
    expect(() =>
      assertNotInGitCheckout("/Users/zoë q/Library/Application Support/EM OS", () => false),
    ).not.toThrow();
  });
});

describe("dataLayout", () => {
  it("places the db, backups, run, config and logs under the data dir", () => {
    const l = dataLayout("/d");
    expect(l.dataDir).toBe("/d");
    expect(l.dbFile.replaceAll("\\", "/")).toBe("/d/db/emos.db");
    expect(l.backupsDir.replaceAll("\\", "/")).toBe("/d/backups");
    expect(l.runDir.replaceAll("\\", "/")).toBe("/d/run");
    expect(l.configDir.replaceAll("\\", "/")).toBe("/d/config");
    expect(l.logsDir.replaceAll("\\", "/")).toBe("/d/logs");
  });
});
