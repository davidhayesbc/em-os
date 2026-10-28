import { describe, expect, it } from "vitest";
import {
  DIRECTION_LABEL,
  formatDiff,
  formatDue,
  formatInstant,
  isCurrentlyOverdue,
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

  it("uses the stored time zone for date-only deadlines", () => {
    // 2026-10-29 01:00 UTC is still 2026-10-28 18:00 in Los Angeles (PDT, UTC-7).
    expect(
      isOverdue(
        { date: "2026-10-28", time: null, timeZone: "America/Los_Angeles" },
        new Date("2026-10-29T01:00:00Z"),
      ),
    ).toBe(false);
    // Once it is past midnight in the stored zone it is overdue.
    expect(
      isOverdue(
        { date: "2026-10-28", time: null, timeZone: "America/Los_Angeles" },
        new Date("2026-10-29T08:00:00Z"),
      ),
    ).toBe(true);
  });

  it("honours explicit due times", () => {
    expect(
      isOverdue(
        { date: "2026-10-28", time: "14:00", timeZone: "America/Los_Angeles" },
        new Date("2026-10-28T20:59:00Z"),
      ),
    ).toBe(false);
    expect(
      isOverdue(
        { date: "2026-10-28", time: "14:00", timeZone: "America/Los_Angeles" },
        new Date("2026-10-28T21:01:00Z"),
      ),
    ).toBe(true);
  });

  it("handles DST boundaries", () => {
    // Day before the US fall-back transition, Los Angeles is still on PDT (UTC-7).
    expect(
      isOverdue(
        { date: "2026-10-31", time: null, timeZone: "America/Los_Angeles" },
        new Date("2026-11-01T05:30:00Z"),
      ),
    ).toBe(false);
    // Before the post-transition end of day it is not overdue; once past
    // midnight in the stored zone it is.
    expect(
      isOverdue(
        { date: "2026-11-01", time: null, timeZone: "America/Los_Angeles" },
        new Date("2026-11-02T07:30:00Z"),
      ),
    ).toBe(false);
    expect(
      isOverdue(
        { date: "2026-11-01", time: null, timeZone: "America/Los_Angeles" },
        new Date("2026-11-02T08:30:00Z"),
      ),
    ).toBe(true);
    // Spring-forward: a date after the transition resolves correctly.
    expect(
      isOverdue(
        { date: "2026-03-10", time: null, timeZone: "America/Los_Angeles" },
        new Date("2026-03-10T07:30:00Z"),
      ),
    ).toBe(false);
  });

  it("only flags non-terminal commitments as currently overdue", () => {
    const due = { date: "2020-01-01", time: null, timeZone: "UTC" };
    expect(isCurrentlyOverdue("active", due)).toBe(true);
    expect(isCurrentlyOverdue("proposed", due)).toBe(true);
    expect(isCurrentlyOverdue("snoozed", due)).toBe(true);
    expect(isCurrentlyOverdue("done", due)).toBe(false);
    expect(isCurrentlyOverdue("dropped", due)).toBe(false);
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
