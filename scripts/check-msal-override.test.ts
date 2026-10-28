import { describe, expect, it } from "vitest";
import { checkMsalOverride } from "./check-msal-override.mjs";

describe("MSAL Node override", () => {
  it("has an override and installs a patched version", () => {
    const result = checkMsalOverride();
    expect(result.override).toBeTruthy();
    expect(result.installed).toMatch(/^\d+\.\d+\.\d+/);
    const [major, minor] = result.installed.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(7);
    if (major === 7) {
      expect(minor).toBeGreaterThanOrEqual(1);
    }
  });
});
