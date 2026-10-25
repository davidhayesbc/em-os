import { describe, expect, it } from "vitest";
import { nextOccurrence } from "./recurrence.js";

describe("nextOccurrence", () => {
  it("advances a Friday weekly recurrence", () => {
    expect(
      nextOccurrence(
        { freq: "weekly", interval: 1, byWeekday: [5], byMonthDay: null },
        "2026-10-23",
      ),
    ).toBe("2026-10-30");
  });

  it("clamps monthly day 31 to the last day of February", () => {
    expect(
      nextOccurrence(
        { freq: "monthly", interval: 1, byWeekday: null, byMonthDay: 31 },
        "2026-01-31",
      ),
    ).toBe("2026-02-28");
  });
});
