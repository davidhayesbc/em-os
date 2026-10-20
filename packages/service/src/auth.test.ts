import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  generateToken,
  isAllowedHost,
  loadOrCreateToken,
  parseBearer,
  TOKEN_KEY,
  tokensEqual,
  writeTokenFile,
} from "./auth.js";
import { createMemorySecretStore } from "./secrets.js";
import { cleanup, tmpDir } from "./test-helpers.js";

afterEach(cleanup);

describe("generateToken", () => {
  it("is 32 random bytes in base64url (43 chars) and differs each call", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(generateToken()).not.toBe(a);
  });
});

describe("tokensEqual", () => {
  it("compares in constant time and handles length mismatch", () => {
    const t = generateToken();
    expect(tokensEqual(t, t)).toBe(true);
    expect(tokensEqual(t, generateToken())).toBe(false);
    expect(tokensEqual(t, t.slice(1))).toBe(false);
    expect(tokensEqual(t, "")).toBe(false);
    expect(tokensEqual("", "")).toBe(false);
  });
});

describe("parseBearer", () => {
  it("extracts the token from a Bearer header", () => {
    expect(parseBearer("Bearer abc_-1")).toBe("abc_-1");
    expect(parseBearer("bearer abc")).toBe("abc");
  });

  it.each([undefined, "", "Bearer", "Bearer ", "Basic abc", "abc", "Bearer a b"])(
    "returns null for %j",
    (h) => {
      expect(parseBearer(h)).toBeNull();
    },
  );
});

describe("isAllowedHost", () => {
  it("accepts 127.0.0.1:<port> and localhost:<port> only", () => {
    expect(isAllowedHost("127.0.0.1:4000", 4000)).toBe(true);
    expect(isAllowedHost("localhost:4000", 4000)).toBe(true);
    expect(isAllowedHost("LocalHost:4000", 4000)).toBe(true);
  });

  it.each([
    undefined,
    "",
    "127.0.0.1",
    "localhost",
    "127.0.0.1:4001",
    "evil.example.com:4000",
    "localhost.example.com:4000",
    "127.0.0.1.example.com:4000",
    "[::1]:4000",
    "0.0.0.0:4000",
  ])("rejects %j (DNS-rebinding protection)", (h) => {
    expect(isAllowedHost(h, 4000)).toBe(false);
  });
});

describe("writeTokenFile", () => {
  it("writes the token", () => {
    const file = join(tmpDir(), "token");
    writeTokenFile(file, "tok");
    expect(readFileSync(file, "utf8")).toBe("tok");
  });

  it.skipIf(process.platform === "win32")("uses mode 0o600, even over a looser file", () => {
    const file = join(tmpDir(), "token");
    writeFileSync(file, "old", { mode: 0o644 });
    writeTokenFile(file, "tok");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("tok");
  });
});

describe("loadOrCreateToken", () => {
  it("creates and stores a token under emos/token when none exists", async () => {
    const secrets = createMemorySecretStore();
    const token = await loadOrCreateToken(secrets);
    expect(TOKEN_KEY).toBe("emos/token");
    expect(await secrets.get(TOKEN_KEY)).toBe(token);
  });

  it("reuses the stored token (one token per install)", async () => {
    const secrets = createMemorySecretStore();
    const first = await loadOrCreateToken(secrets);
    expect(await loadOrCreateToken(secrets)).toBe(first);
  });

  it("replaces a malformed stored token", async () => {
    const secrets = createMemorySecretStore();
    await secrets.set(TOKEN_KEY, "short");
    const token = await loadOrCreateToken(secrets);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await secrets.get(TOKEN_KEY)).toBe(token);
  });
});
