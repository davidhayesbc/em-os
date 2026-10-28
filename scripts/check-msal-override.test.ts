import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  caretSatisfies,
  checkMsalOverride,
  isValidMsalOverride,
  parseCaretRange,
  parseStableVersion,
  stableGte,
} from "./check-msal-override.mjs";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; // 9007199254740991
const JUST_OVER_MAX_SAFE_INTEGER = String(MAX_SAFE_INTEGER + 1);

function makeFixture(override: unknown, installed: unknown) {
  const root = mkdtempSync(join(tmpdir(), "check-msal-override-"));
  const msalDir = join(root, "node_modules", "@azure", "msal-node");
  mkdirSync(msalDir, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ overrides: { "@azure/msal-node": override } }),
  );
  writeFileSync(join(msalDir, "package.json"), JSON.stringify({ version: installed }));
  return root;
}

function cleanupFixture(root: string) {
  rmSync(root, { recursive: true, force: true });
}

describe("parseStableVersion", () => {
  it("accepts stable releases", () => {
    expect(parseStableVersion("7.1.0")).toEqual([7, 1, 0]);
    expect(parseStableVersion("7.1.2")).toEqual([7, 1, 2]);
    expect(parseStableVersion("6.0.1")).toEqual([6, 0, 1]);
  });

  it("rejects prerelease and build metadata", () => {
    expect(parseStableVersion("7.1.0-beta.0")).toBeNull();
    expect(parseStableVersion("7.1.2+build.1")).toBeNull();
    expect(parseStableVersion("7.1.0-beta.0+exp")).toBeNull();
  });

  it("rejects malformed strings", () => {
    expect(parseStableVersion("not-a-version")).toBeNull();
    expect(parseStableVersion("7.1")).toBeNull();
    expect(parseStableVersion("7.1.x")).toBeNull();
    expect(parseStableVersion("v7.1.2")).toBeNull();
    expect(parseStableVersion("")).toBeNull();
  });

  it("accepts components up to MAX_SAFE_INTEGER", () => {
    const atLimit = `${MAX_SAFE_INTEGER}.${MAX_SAFE_INTEGER}.${MAX_SAFE_INTEGER}`;
    expect(parseStableVersion(atLimit)).toEqual([
      MAX_SAFE_INTEGER,
      MAX_SAFE_INTEGER,
      MAX_SAFE_INTEGER,
    ]);
  });

  it("rejects oversized components that exceed MAX_SAFE_INTEGER", () => {
    const overMajor = `${JUST_OVER_MAX_SAFE_INTEGER}.1.2`;
    const overMinor = `7.${JUST_OVER_MAX_SAFE_INTEGER}.2`;
    const overPatch = `7.1.${JUST_OVER_MAX_SAFE_INTEGER}`;
    expect(parseStableVersion(overMajor)).toBeNull();
    expect(parseStableVersion(overMinor)).toBeNull();
    expect(parseStableVersion(overPatch)).toBeNull();
  });

  it("rejects non-finite components", () => {
    expect(parseStableVersion("Infinity.1.2")).toBeNull();
    expect(parseStableVersion("7.Infinity.2")).toBeNull();
    expect(parseStableVersion("7.1.Infinity")).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(parseStableVersion(null as unknown as string)).toBeNull();
    expect(parseStableVersion(undefined as unknown as string)).toBeNull();
    expect(parseStableVersion(7.1 as unknown as string)).toBeNull();
    expect(parseStableVersion(true as unknown as string)).toBeNull();
    expect(parseStableVersion({} as unknown as string)).toBeNull();
    expect(parseStableVersion(["7.1.2"] as unknown as string)).toBeNull();
    expect(parseStableVersion([["7.1.2"]] as unknown as string)).toBeNull();
  });
});

describe("parseCaretRange", () => {
  it("accepts caret ranges with safe-integer lower bounds", () => {
    expect(parseCaretRange("^7.1.2")).toEqual([7, 1, 2]);
    expect(parseCaretRange("^7.1.0")).toEqual([7, 1, 0]);
    expect(parseCaretRange("^8.0.0")).toEqual([8, 0, 0]);
  });

  it("rejects oversized caret lower bounds", () => {
    expect(parseCaretRange(`^${JUST_OVER_MAX_SAFE_INTEGER}.1.2`)).toBeNull();
    expect(parseCaretRange(`^7.${JUST_OVER_MAX_SAFE_INTEGER}.2`)).toBeNull();
    expect(parseCaretRange(`^7.1.${JUST_OVER_MAX_SAFE_INTEGER}`)).toBeNull();
  });

  it("rejects malformed and non-caret ranges", () => {
    expect(parseCaretRange("7.1.2")).toBeNull();
    expect(parseCaretRange("~7.1.2")).toBeNull();
    expect(parseCaretRange("^>=7.1.2")).toBeNull();
    expect(parseCaretRange("^7.1.0-beta.0")).toBeNull();
    expect(parseCaretRange("not-a-version")).toBeNull();
    expect(parseCaretRange("")).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(parseCaretRange(null as unknown as string)).toBeNull();
    expect(parseCaretRange(undefined as unknown as string)).toBeNull();
    expect(parseCaretRange(7.1 as unknown as string)).toBeNull();
    expect(parseCaretRange(true as unknown as string)).toBeNull();
    expect(parseCaretRange({} as unknown as string)).toBeNull();
    expect(parseCaretRange(["^7.1.2"] as unknown as string)).toBeNull();
    expect(parseCaretRange([["^7.1.2"]] as unknown as string)).toBeNull();
  });
});

describe("stableGte", () => {
  it("accepts patched stable releases", () => {
    expect(stableGte("7.1.0", "7.1.0")).toBe(true);
    expect(stableGte("7.1.2", "7.1.0")).toBe(true);
  });

  it("rejects vulnerable stable releases", () => {
    expect(stableGte("6.0.1", "7.1.0")).toBe(false);
    expect(stableGte("7.0.9", "7.1.0")).toBe(false);
  });

  it("rejects prerelease boundary", () => {
    expect(stableGte("7.1.0-beta.0", "7.1.0")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(stableGte("not-a-version", "7.1.0")).toBe(false);
    expect(stableGte("7.1.0", "not-a-version")).toBe(false);
  });

  it("rejects oversized versions that would round or overflow", () => {
    expect(stableGte("7.1.9007199254740993", "7.1.9007199254740992")).toBe(false);
    expect(stableGte(`7.1.${"9".repeat(310)}`, "7.1.2")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(stableGte(null as unknown as string, "7.1.0")).toBe(false);
    expect(stableGte("7.1.0", null as unknown as string)).toBe(false);
    expect(stableGte(["7.1.2"] as unknown as string, "7.1.0")).toBe(false);
    expect(stableGte("7.1.2", ["7.1.0"] as unknown as string)).toBe(false);
  });
});

describe("isValidMsalOverride", () => {
  it("accepts caret ranges with lower bound at or above 7.1.0", () => {
    expect(isValidMsalOverride("^7.1.0")).toBe(true);
    expect(isValidMsalOverride("^7.1.2")).toBe(true);
    expect(isValidMsalOverride("^8.0.0")).toBe(true);
  });

  it("rejects caret ranges below the advisory patched start", () => {
    expect(isValidMsalOverride("^6.0.1")).toBe(false);
    expect(isValidMsalOverride("^7.0.9")).toBe(false);
  });

  it("rejects non-caret and malformed ranges", () => {
    expect(isValidMsalOverride("7.1.2")).toBe(false);
    expect(isValidMsalOverride("~7.1.2")).toBe(false);
    expect(isValidMsalOverride("^>=7.1.2")).toBe(false);
    expect(isValidMsalOverride("^7.1.0-beta.0")).toBe(false);
    expect(isValidMsalOverride("not-a-version")).toBe(false);
    expect(isValidMsalOverride("")).toBe(false);
  });

  it("rejects oversized lower bounds", () => {
    expect(isValidMsalOverride(`^${JUST_OVER_MAX_SAFE_INTEGER}.1.2`)).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidMsalOverride(null as unknown as string)).toBe(false);
    expect(isValidMsalOverride(undefined as unknown as string)).toBe(false);
    expect(isValidMsalOverride(["^7.1.2"] as unknown as string)).toBe(false);
    expect(isValidMsalOverride([["^7.1.2"]] as unknown as string)).toBe(false);
  });
});

describe("caretSatisfies", () => {
  it("accepts versions inside the caret range", () => {
    expect(caretSatisfies("7.1.2", "^7.1.2")).toBe(true);
    expect(caretSatisfies("7.1.3", "^7.1.2")).toBe(true);
    expect(caretSatisfies("7.2.0", "^7.1.2")).toBe(true);
  });

  it("rejects versions below the caret lower bound", () => {
    expect(caretSatisfies("7.1.0", "^7.1.2")).toBe(false);
    expect(caretSatisfies("7.0.9", "^7.1.2")).toBe(false);
  });

  it("rejects prerelease and malformed versions", () => {
    expect(caretSatisfies("7.1.2-beta.0", "^7.1.2")).toBe(false);
    expect(caretSatisfies("not-a-version", "^7.1.2")).toBe(false);
  });

  it("rejects oversized installed versions", () => {
    expect(caretSatisfies(`7.1.${"9".repeat(310)}`, "^7.1.2")).toBe(false);
    expect(caretSatisfies("7.1.9007199254740993", "^7.1.2")).toBe(false);
  });

  it("rejects oversized caret ranges", () => {
    expect(caretSatisfies("7.1.2", `^7.1.${JUST_OVER_MAX_SAFE_INTEGER}`)).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(caretSatisfies(null as unknown as string, "^7.1.2")).toBe(false);
    expect(caretSatisfies("7.1.2", null as unknown as string)).toBe(false);
    expect(caretSatisfies(["7.1.2"] as unknown as string, "^7.1.2")).toBe(false);
    expect(caretSatisfies("7.1.2", ["^7.1.2"] as unknown as string)).toBe(false);
  });
});

describe("MSAL Node override (live fixture)", () => {
  it("has a valid override and installs a patched stable version", () => {
    const result = checkMsalOverride();
    expect(result.override).toBe("^7.1.2");
    expect(result.installed).toBe("7.1.2");
  });
});

describe("MSAL Node override (isolated fixture)", () => {
  it("rejects an oversized installed patch", () => {
    const root = makeFixture("^7.1.2", `7.1.${"9".repeat(310)}`);
    try {
      expect(() => checkMsalOverride(root)).toThrow(/not a stable release/);
    } finally {
      cleanupFixture(root);
    }
  });

  it("rejects an oversized override lower bound", () => {
    const root = makeFixture("^7.1.9007199254740993", "7.1.9007199254740992");
    try {
      expect(() => checkMsalOverride(root)).toThrow(/Invalid @azure\/msal-node override/);
    } finally {
      cleanupFixture(root);
    }
  });

  it("accepts ordinary 7.1.2/^7.1.2", () => {
    const root = makeFixture("^7.1.2", "7.1.2");
    try {
      expect(checkMsalOverride(root)).toEqual({
        override: "^7.1.2",
        installed: "7.1.2",
      });
    } finally {
      cleanupFixture(root);
    }
  });
});

describe("MSAL Node override (JSON-shape regression fixtures)", () => {
  it.each([
    ["null installed version", "^7.1.2", null, /not a stable release/],
    ["number installed version", "^7.1.2", 7.1, /not a stable release/],
    ["boolean installed version", "^7.1.2", true, /not a stable release/],
    ["object installed version", "^7.1.2", { version: "7.1.2" }, /not a stable release/],
    ["singleton array installed version", "^7.1.2", ["7.1.2"], /not a stable release/],
    ["nested array installed version", "^7.1.2", [[["7.1.2"]]], /not a stable release/],
    ["null override", null, "7.1.2", /missing the @azure\/msal-node override/],
    ["number override", 7.1, "7.1.2", /Invalid @azure\/msal-node override/],
    ["boolean override", true, "7.1.2", /Invalid @azure\/msal-node override/],
    ["object override", { range: "^7.1.2" }, "7.1.2", /Invalid @azure\/msal-node override/],
    ["singleton array override", ["^7.1.2"], "7.1.2", /Invalid @azure\/msal-node override/],
    ["nested array override", [[["^7.1.2"]]], "7.1.2", /Invalid @azure\/msal-node override/],
  ])("rejects %s", (_label, override, installed, expected) => {
    const root = makeFixture(override, installed);
    try {
      expect(() => checkMsalOverride(root)).toThrow(expected);
    } finally {
      cleanupFixture(root);
    }
  });

  it("retains ordinary 7.1.2/^7.1.2", () => {
    const root = makeFixture("^7.1.2", "7.1.2");
    try {
      expect(checkMsalOverride(root)).toEqual({
        override: "^7.1.2",
        installed: "7.1.2",
      });
    } finally {
      cleanupFixture(root);
    }
  });
});
