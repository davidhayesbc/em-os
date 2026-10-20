import { describe, expect, it } from "vitest";
import { toDbInstant } from "./time.js";

describe("toDbInstant", () => {
  it("keeps canonical instants unchanged", () => {
    expect(toDbInstant("2026-10-20T16:00:00.000Z")).toBe("2026-10-20T16:00:00.000Z");
  });

  it("normalises a value without milliseconds to .sssZ", () => {
    expect(toDbInstant("2026-10-20T16:00:00Z")).toBe("2026-10-20T16:00:00.000Z");
  });

  it("normalises microsecond precision to .sssZ", () => {
    expect(toDbInstant("2026-10-20T16:00:00.123456Z")).toBe("2026-10-20T16:00:00.123Z");
  });

  it("converts an explicit offset to UTC", () => {
    expect(toDbInstant("2026-10-20T09:00:00-07:00")).toBe("2026-10-20T16:00:00.000Z");
  });

  it("accepts a Date", () => {
    expect(toDbInstant(new Date(Date.UTC(2026, 9, 20, 16)))).toBe("2026-10-20T16:00:00.000Z");
  });

  it("throws RangeError on invalid input", () => {
    expect(() => toDbInstant("not a date")).toThrow(RangeError);
    expect(() => toDbInstant(new Date(Number.NaN))).toThrow(RangeError);
  });

  it("refuses zone-less values, which JS would read in the host's local zone", () => {
    expect(() => toDbInstant("2026-10-20T16:00:00")).toThrow(RangeError);
    expect(() => toDbInstant("2026-10-20")).toThrow(RangeError);
  });
});
