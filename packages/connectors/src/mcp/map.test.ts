import { describe, expect, it } from "vitest";
import { applyResultMapping } from "./map.js";

describe("applyResultMapping", () => {
  it("resolves start.dateTime|start.date to the date for all-day events", () => {
    const raw = {
      events: [
        {
          id: "evt-1",
          summary: "All-day offsite",
          start: { date: "2026-10-21" },
          end: { date: "2026-10-22" },
          htmlLink: "https://cal.example.com/e/1",
          status: "confirmed",
          attendees: [],
          recurringEventId: null,
        },
        {
          id: "evt-2",
          summary: "Stand-up",
          start: { dateTime: "2026-10-21T09:00:00.000Z" },
          end: { dateTime: "2026-10-21T09:30:00.000Z" },
          htmlLink: "https://cal.example.com/e/2",
          status: "confirmed",
          attendees: ["alex@example.com"],
          recurringEventId: "rec-1",
        },
      ],
      next: "page-2",
    };

    const mapping = {
      items: "$.events[*]",
      nextCursor: "$.next",
      fields: {
        externalId: "id",
        title: "summary",
        start: "start.dateTime|start.date",
        end: "end.dateTime|end.date",
        attendees: "attendees",
        url: "htmlLink",
        status: "status",
        recurringEventId: "recurringEventId",
      },
    };

    const result = applyResultMapping(raw, mapping);
    expect(result.items).toEqual([
      {
        externalId: "evt-1",
        title: "All-day offsite",
        start: "2026-10-21",
        end: "2026-10-22",
        attendees: [],
        url: "https://cal.example.com/e/1",
        status: "confirmed",
        recurringEventId: null,
      },
      {
        externalId: "evt-2",
        title: "Stand-up",
        start: "2026-10-21T09:00:00.000Z",
        end: "2026-10-21T09:30:00.000Z",
        attendees: ["alex@example.com"],
        url: "https://cal.example.com/e/2",
        status: "confirmed",
        recurringEventId: "rec-1",
      },
    ]);
    expect(result.nextCursor).toBe("page-2");
  });

  it("returns null for unknown paths", () => {
    const raw = { events: [{ id: "a" }] };
    const mapping = {
      items: "$.events[*]",
      fields: { missing: "not.there|also.missing" },
    };

    const result = applyResultMapping(raw, mapping);
    expect(result.items).toEqual([{ missing: null }]);
    expect(result.nextCursor).toBeNull();
  });
});
