import type { Meeting } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { freeBlocks } from "./free-blocks.js";

const LA = "America/Los_Angeles";

function meeting(overrides: Partial<Meeting> & { start: string; end: string }): Meeting {
  const base: Meeting = {
    id: "m-1",
    connectorId: "cal-test",
    externalId: "ext-1",
    title: "Test meeting",
    start: overrides.start,
    end: overrides.end,
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification: "other",
    classificationSource: "auto",
    personId: null,
    attendees: [],
    actionItems: [],
    url: null,
    occurredAt: overrides.start,
    capturedAt: overrides.start,
    updatedAt: overrides.start,
    retentionState: "active",
  };
  return { ...base, ...overrides };
}

describe("freeBlocks", () => {
  it("finds free blocks between two meetings", () => {
    const localDate = "2026-10-20";
    const blocks = freeBlocks({
      localDate,
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [
        meeting({ start: "2026-10-20T16:00:00Z", end: "2026-10-20T16:15:00Z" }),
        meeting({ start: "2026-10-20T17:30:00Z", end: "2026-10-20T18:00:00Z" }),
      ],
      now: new Date("2026-10-19T12:00:00Z"),
      minMinutes: 15,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      start: "2026-10-20T16:15:00.000Z",
      end: "2026-10-20T17:30:00.000Z",
      minutes: 75,
    });
    expect(blocks[1]).toEqual({
      start: "2026-10-20T18:00:00.000Z",
      end: "2026-10-21T00:00:00.000Z",
      minutes: 360,
    });
  });

  it("drops a 10-minute gap", () => {
    const localDate = "2026-10-20";
    const blocks = freeBlocks({
      localDate,
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [
        meeting({ start: "2026-10-20T16:00:00Z", end: "2026-10-20T16:50:00Z" }),
        meeting({ start: "2026-10-20T17:00:00Z", end: "2026-10-20T17:30:00Z" }),
      ],
      now: new Date("2026-10-19T12:00:00Z"),
      minMinutes: 15,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      start: "2026-10-20T17:30:00.000Z",
      end: "2026-10-21T00:00:00.000Z",
      minutes: 390,
    });
  });

  it("does not block time for a declined meeting", () => {
    const localDate = "2026-10-20";
    const blocks = freeBlocks({
      localDate,
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [
        meeting({
          start: "2026-10-20T16:00:00Z",
          end: "2026-10-20T17:00:00Z",
          selfResponse: "declined",
        }),
      ],
      now: new Date("2026-10-19T12:00:00Z"),
      minMinutes: 15,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      start: "2026-10-20T16:00:00.000Z",
      end: "2026-10-21T00:00:00.000Z",
      minutes: 480,
    });
  });

  it("clips today's free blocks to now", () => {
    const localDate = "2026-10-20";
    const blocks = freeBlocks({
      localDate,
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [
        meeting({ start: "2026-10-20T16:00:00Z", end: "2026-10-20T16:15:00Z" }),
        meeting({ start: "2026-10-20T17:30:00Z", end: "2026-10-20T18:00:00Z" }),
      ],
      now: new Date("2026-10-20T21:20:00Z"),
      minMinutes: 15,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      start: "2026-10-20T21:20:00.000Z",
      end: "2026-10-21T00:00:00.000Z",
      minutes: 160,
    });
  });

  it("treats a meeting in another zone as local wall time", () => {
    const localDate = "2026-10-20";
    const blocks = freeBlocks({
      localDate,
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [
        meeting({
          start: "2026-10-20T13:00:00Z",
          end: "2026-10-20T14:00:00Z",
          title: "09:00 NY meeting",
        }),
      ],
      now: new Date("2026-10-19T12:00:00Z"),
      minMinutes: 15,
    });

    // 09:00 EDT is 06:00 PDT, outside 09-17 working hours, so it consumes nothing.
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      start: "2026-10-20T16:00:00.000Z",
      end: "2026-10-21T00:00:00.000Z",
      minutes: 480,
    });
  });

  it("keeps an 8-hour working window on the US DST fall-back day", () => {
    const localDate = "2026-11-01";
    const blocks = freeBlocks({
      localDate,
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [],
      now: new Date("2026-10-31T12:00:00Z"),
      minMinutes: 15,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      start: "2026-11-01T17:00:00.000Z",
      end: "2026-11-02T01:00:00.000Z",
      minutes: 480,
    });
  });
});
