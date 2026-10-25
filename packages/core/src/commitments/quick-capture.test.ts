import { describe, expect, it } from "vitest";
import { parseQuickCapture } from "./quick-capture.js";

const now = new Date("2026-10-20T16:00:00Z");
const timeZone = "America/Los_Angeles";

describe("parseQuickCapture", () => {
  it("parses person, weekday, priority, and tag tokens wherever they appear", () => {
    expect(parseQuickCapture("Send hiring feedback @sam !fri !p1 #hiring", now, timeZone)).toEqual({
      title: "Send hiring feedback",
      direction: "mine",
      personQuery: "sam",
      due: { date: "2026-10-23", time: null, timeZone },
      priority: 1,
      urgency: null,
      tags: ["hiring"],
      recurrence: null,
    });
  });

  it("parses a leading wait marker as owed to me", () => {
    expect(parseQuickCapture("wait @jordan API spec !thu", now, timeZone)).toMatchObject({
      direction: "owed_to_me",
      personQuery: "jordan",
      title: "API spec",
      due: { date: "2026-10-22" },
    });
  });

  it("includes today when resolving weekday tokens", () => {
    expect(parseQuickCapture("x !tue", now, timeZone)).toMatchObject({
      due: { date: "2026-10-20" },
    });
  });

  it("parses relative day offsets", () => {
    expect(parseQuickCapture("x !+3d", now, timeZone)).toMatchObject({
      due: { date: "2026-10-23" },
    });
  });

  it("rejects relative day offsets outside the supported date range", () => {
    expect(parseQuickCapture("x !+100000000d", now, timeZone)).toEqual({
      error: "invalid_due_date",
    });
  });

  it("rejects captures containing only metadata", () => {
    expect(parseQuickCapture("@sam !p1", now, timeZone)).toEqual({ error: "empty_title" });
  });

  it("parses weekly recurrence and defaults its due date", () => {
    expect(parseQuickCapture("EOW update !every-fri", now, timeZone)).toMatchObject({
      title: "EOW update",
      recurrence: { freq: "weekly", interval: 1, byWeekday: [5], byMonthDay: null },
      due: { date: "2026-10-23" },
    });
  });

  it("parses fixed dates, urgency, daily/monthly recurrence, tags, and first-person wins", () => {
    expect(
      parseQuickCapture(
        "Plan @sam @jordan !2026-11-04 !soon !p2 #alpha #beta !every-month",
        now,
        timeZone,
      ),
    ).toEqual({
      title: "Plan",
      direction: "mine",
      personQuery: "sam",
      due: { date: "2026-11-04", time: null, timeZone },
      priority: 2,
      urgency: "soon",
      tags: ["alpha", "beta"],
      recurrence: { freq: "monthly", interval: 1, byWeekday: null, byMonthDay: 4 },
    });
    expect(parseQuickCapture("Standup !every-day", now, timeZone)).toMatchObject({
      due: { date: "2026-10-20" },
      recurrence: { freq: "daily", interval: 1, byWeekday: null, byMonthDay: null },
    });
    expect(parseQuickCapture("Plan !every-month !2026-11-04", now, timeZone)).toMatchObject({
      due: { date: "2026-11-04" },
      recurrence: { freq: "monthly", interval: 1, byWeekday: null, byMonthDay: 4 },
    });
  });
});
