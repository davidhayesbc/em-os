import { describe, expect, it } from "vitest";
import {
  DIRECTION_LABEL,
  formatDiff,
  formatDue,
  formatInstant,
  isOverdue,
  STATUS_LABEL,
} from "./utils.js";

describe("commitments-alpha utils", () => {
  it("labels directions", () => {
    expect(DIRECTION_LABEL.mine).toBe("I owe");
    expect(DIRECTION_LABEL.owed_to_me).toBe("Owed to me");
  });

  it("labels statuses", () => {
    expect(STATUS_LABEL.active).toBe("Active");
    expect(STATUS_LABEL.done).toBe("Done");
  });

  it("formats due dates", () => {
    expect(formatDue(null)).toBe("No date");
    expect(formatDue({ date: "2026-10-30", time: null, timeZone: "UTC" })).toBe("2026-10-30 (UTC)");
    expect(formatDue({ date: "2026-10-30", time: "14:00", timeZone: "America/Los_Angeles" })).toBe(
      "2026-10-30 14:00 (America/Los_Angeles)",
    );
  });

  it("detects overdue dates", () => {
    expect(isOverdue(null)).toBe(false);
    expect(
      isOverdue({ date: "2026-01-01", time: null, timeZone: "UTC" }, new Date("2026-01-02")),
    ).toBe(true);
    expect(
      isOverdue(
        { date: "2026-01-02", time: null, timeZone: "UTC" },
        new Date("2026-01-02T12:00:00Z"),
      ),
    ).toBe(false);
    expect(isOverdue({ date: "2099-01-01", time: null, timeZone: "UTC" })).toBe(false);
  });

  it("formats instants", () => {
    expect(formatInstant(null)).toBe("—");
    expect(formatInstant("not-a-date")).toBe("not-a-date");
    expect(formatInstant("2026-10-20T16:00:00.000Z")).toContain("Oct");
  });

  it("formats audit diffs", () => {
    expect(
      formatDiff({ due: { from: null, to: { date: "2026-10-30", time: null, timeZone: "UTC" } } }),
    ).toContain("due");
  });
});
