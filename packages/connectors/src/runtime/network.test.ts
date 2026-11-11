import { describe, expect, it } from "vitest";
import { classifyNetworkError, extractServerName } from "./network.js";

describe("classifyNetworkError", () => {
  it.each(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"])(
    "classifies %s as offline",
    (code) => {
      const err = new Error(code) as Error & { code: string };
      err.code = code;
      expect(classifyNetworkError(err)).toBe("offline");
    },
  );

  it("classifies undici fetch failed as offline", () => {
    expect(classifyNetworkError(new Error("fetch failed"))).toBe("offline");
  });

  it("classifies 429 as transient", () => {
    expect(classifyNetworkError({ status: 429 })).toBe("transient");
  });

  it("classifies 5xx as transient", () => {
    expect(classifyNetworkError({ status: 503 })).toBe("transient");
  });

  it("returns null for unrelated errors", () => {
    expect(classifyNetworkError(new Error("something else"))).toBe(null);
  });
});

describe("extractServerName", () => {
  it("extracts the hostname from an ENOTFOUND message", () => {
    const err = new Error("getaddrinfo ENOTFOUND cal.example.com") as Error & { code: string };
    err.code = "ENOTFOUND";
    expect(extractServerName(err)).toBe("cal.example.com");
  });
});
