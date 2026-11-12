import { describe, expect, it } from "vitest";
import { LAST_ERROR_MAX_LENGTH, sanitizeLastError } from "./sanitize.js";

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
