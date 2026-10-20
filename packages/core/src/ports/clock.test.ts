import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "./clock.js";

describe("clocks", () => {
  it("fixedClock always returns the given instant", () => {
    const c = fixedClock("2026-10-20T16:00:00.000Z");
    expect(c.now().toISOString()).toBe("2026-10-20T16:00:00.000Z");
    expect(c.now().toISOString()).toBe("2026-10-20T16:00:00.000Z");
  });

  it("fixedClock returns fresh Date objects so callers cannot mutate shared state", () => {
    const c = fixedClock("2026-10-20T16:00:00.000Z");
    c.now().setUTCFullYear(1999);
    expect(c.now().toISOString()).toBe("2026-10-20T16:00:00.000Z");
  });

  it("fixedClock rejects an invalid ISO string", () => {
    expect(() => fixedClock("not a date")).toThrow(RangeError);
  });

  it("systemClock returns a current Date", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
