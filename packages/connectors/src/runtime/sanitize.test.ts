import { describe, expect, it } from "vitest";
import { LAST_ERROR_MAX_LENGTH, redactSecrets, sanitizeLastError } from "./sanitize.js";

describe("sanitizeLastError", () => {
  it("strips C0/C1 control characters and Unicode format characters", () => {
    // Control characters are removed; the printable remainder of an ANSI sequence stays.
    expect(sanitizeLastError("line\none\u0000two\u001b[31mthree")).toBe("lineonetwo[31mthree");
    expect(sanitizeLastError("\u200b\u200c\u200d")).toBe("");
  });

  it("truncates on code-point boundaries to LAST_ERROR_MAX_LENGTH", () => {
    const message = "a".repeat(LAST_ERROR_MAX_LENGTH + 100);
    const out = sanitizeLastError(message);
    expect(out).toHaveLength(LAST_ERROR_MAX_LENGTH);
    expect(out).toBe("a".repeat(LAST_ERROR_MAX_LENGTH));
  });

  it("does not split surrogate pairs when truncating", () => {
    const message = "🙂".repeat(600);
    const out = sanitizeLastError(message);
    expect(Array.from(out)).toHaveLength(LAST_ERROR_MAX_LENGTH);
    expect(out).not.toContain("\uFFFD");
  });

  it("returns an empty string when the message contains only control characters", () => {
    expect(sanitizeLastError("\n\u001b[31m\u0000")).toBe("[31m");
    expect(sanitizeLastError("\u200b")).toBe("");
  });

  it("does not coerce non-string values (keeps the helper typed to string)", () => {
    // Runtime enforcement: the helper is typed `string`, so non-string inputs are not coerced.
    expect(() => sanitizeLastError(undefined as unknown as string)).toThrow(expect.any(Error));
    expect(() => sanitizeLastError(null as unknown as string)).toThrow(expect.any(Error));
    expect(() => sanitizeLastError(12345 as unknown as string)).toThrow(expect.any(Error));
  });
});

describe("redactSecrets", () => {
  it("redacts secret string values and leaves non-secret values visible", () => {
    const config = { apiKey: "SECRET-VALUE", endpoint: "https://example.com" };
    const message = `apiKey=${config.apiKey} endpoint=${config.endpoint}`;
    expect(redactSecrets(message, config)).toBe("apiKey=[redacted] endpoint=https://example.com");
  });

  it("collects nested and array secret values", () => {
    const config = {
      auth: { token: "NESTED-TOKEN" },
      apiKeys: ["ARRAY-ONE", "ARRAY-TWO"],
    };
    const message = "token=NESTED-TOKEN keys=ARRAY-ONE,ARRAY-TWO";
    expect(redactSecrets(message, config)).toBe("token=[redacted] keys=[redacted],[redacted]");
  });

  it("redacts both raw and JSON-escaped occurrences of a secret", () => {
    const sentinel = 'sec"ret\\!';
    const config = { apiKey: sentinel };
    const message = `raw: ${sentinel} json: ${JSON.stringify(config)}`;
    expect(redactSecrets(message, config)).toBe('raw: [redacted] json: {"apiKey":[redacted]}');
  });

  it("replaces longer secrets before shorter ones to avoid partial fragments", () => {
    const config = { token: "abcd", apiKey: "abcdef" };
    const message = "abcd abcdef";
    expect(redactSecrets(message, config)).toBe("[redacted] [redacted]");
  });

  it("skips very short secret values to avoid over-redaction", () => {
    const config = { token: "abc", apiKey: "secret-value" };
    const message = "abc secret-value";
    expect(redactSecrets(message, config)).toBe("abc [redacted]");
  });

  it("returns the message unchanged when the config has no secret values", () => {
    const config = { endpoint: "https://example.com", timeout: 30 };
    expect(redactSecrets("endpoint=https://example.com", config)).toBe(
      "endpoint=https://example.com",
    );
  });
});
