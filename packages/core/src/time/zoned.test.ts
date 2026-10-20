import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  localMinutes,
  localWeekdayIndex,
  startOfLocalDay,
  toLocalDate,
} from "./zoned.js";

const LA = "America/Los_Angeles";

describe("startOfLocalDay", () => {
  it("start of day across US DST fall-back", () => {
    expect(startOfLocalDay("2026-11-01", LA).toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(startOfLocalDay("2026-11-02", LA).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("spring-forward day starts at 08:00Z (still PST at midnight)", () => {
    expect(startOfLocalDay("2026-03-08", LA).toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(startOfLocalDay("2026-03-09", LA).toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });

  it("handles a southern-hemisphere zone (Australia/Sydney DST start 2026-10-04)", () => {
    expect(startOfLocalDay("2026-10-04", "Australia/Sydney").toISOString()).toBe(
      "2026-10-03T14:00:00.000Z",
    );
    expect(startOfLocalDay("2026-10-05", "Australia/Sydney").toISOString()).toBe(
      "2026-10-04T13:00:00.000Z",
    );
  });

  it("handles Europe/London fall-back (2026-10-25)", () => {
    expect(startOfLocalDay("2026-10-25", "Europe/London").toISOString()).toBe(
      "2026-10-24T23:00:00.000Z",
    );
    expect(startOfLocalDay("2026-10-26", "Europe/London").toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
  });

  it("is the identity offset for UTC", () => {
    expect(startOfLocalDay("2026-10-20", "UTC").toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("round-trips through toLocalDate / localMinutes", () => {
    const start = startOfLocalDay("2026-11-01", LA);
    expect(toLocalDate(start, LA)).toBe("2026-11-01");
    expect(localMinutes(start, LA)).toBe(0);
  });

  it("rejects malformed or impossible dates", () => {
    expect(() => startOfLocalDay("2026-1-5", LA)).toThrow(RangeError);
    expect(() => startOfLocalDay("2026-02-30", LA)).toThrow(RangeError);
  });

  it("throws RangeError for an invalid time zone", () => {
    expect(() => startOfLocalDay("2026-10-20", "Not/AZone")).toThrow(RangeError);
  });
});

describe("toLocalDate", () => {
  it("respects zone", () => {
    expect(toLocalDate(new Date("2026-10-20T05:30:00Z"), LA)).toBe("2026-10-19");
    expect(toLocalDate(new Date("2026-10-20T05:30:00Z"), "UTC")).toBe("2026-10-20");
    expect(toLocalDate(new Date("2026-10-20T05:30:00Z"), "Australia/Sydney")).toBe("2026-10-20");
  });

  it("throws RangeError for an invalid time zone", () => {
    expect(() => toLocalDate(new Date(), "Not/AZone")).toThrow(RangeError);
  });

  it("throws RangeError for an invalid Date", () => {
    expect(() => toLocalDate(new Date(Number.NaN), LA)).toThrow(RangeError);
  });
});

describe("localMinutes", () => {
  it("returns minutes since local midnight", () => {
    expect(localMinutes(new Date("2026-10-20T16:30:00Z"), LA)).toBe(9 * 60 + 30);
  });

  it("reports 0 (not 1440) at local midnight", () => {
    expect(localMinutes(new Date("2026-10-20T07:00:00Z"), LA)).toBe(0);
  });

  it("works in a non-US zone", () => {
    expect(localMinutes(new Date("2026-10-20T16:30:00Z"), "Europe/London")).toBe(17 * 60 + 30);
  });
});

describe("addLocalDays", () => {
  it("adds days within a month", () => {
    expect(addLocalDays("2026-10-19", 1)).toBe("2026-10-20");
  });

  it("crosses a non-leap February", () => {
    expect(addLocalDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("crosses a leap February", () => {
    expect(addLocalDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("crosses a year boundary in both directions", () => {
    expect(addLocalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addLocalDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("supports zero and large offsets", () => {
    expect(addLocalDays("2026-10-19", 0)).toBe("2026-10-19");
    expect(addLocalDays("2026-01-01", 365)).toBe("2027-01-01");
  });

  it("rejects malformed dates and non-integer days", () => {
    expect(() => addLocalDays("nope", 1)).toThrow(RangeError);
    expect(() => addLocalDays("2026-10-19", 1.5)).toThrow(RangeError);
  });
});

describe("localWeekdayIndex", () => {
  it("returns 0=Sun..6=Sat", () => {
    expect(localWeekdayIndex("2026-10-20")).toBe(2);
    expect(localWeekdayIndex("2026-10-18")).toBe(0);
    expect(localWeekdayIndex("2026-10-24")).toBe(6);
  });

  it("rejects malformed dates", () => {
    expect(() => localWeekdayIndex("2026-13-01")).toThrow(RangeError);
  });
});
