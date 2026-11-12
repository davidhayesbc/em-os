import type { Meeting } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import type { RankedItem } from "../ranking/index.js";
import { freeBlocks } from "./free-blocks.js";
import { plan } from "./plan.js";

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

function ranked(commitmentId: string): RankedItem {
  return {
    commitmentId,
    score: 1,
    dominant: "time_critical",
    why: "due today",
    components: [],
  };
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

  it("does not erase the working day when a pre-work meeting crosses the fall-back transition", () => {
    const blocks = freeBlocks({
      localDate: "2026-11-01",
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [meeting({ start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:15:00Z" })],
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

  it("reports the real 180-minute window during a spring-forward day and plans accordingly", () => {
    const blocks = freeBlocks({
      localDate: "2026-03-08",
      timeZone: LA,
      workingHours: { start: "01:00", end: "05:00" },
      meetings: [],
      now: new Date("2026-03-07T12:00:00Z"),
      minMinutes: 15,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      start: "2026-03-08T09:00:00.000Z",
      end: "2026-03-08T12:00:00.000Z",
      minutes: 180,
    });
    const block = blocks[0];
    if (!block) throw new Error("expected a block");
    expect(block.minutes).toBe(
      Math.round((Date.parse(block.end) - Date.parse(block.start)) / 60000),
    );

    // A 240-minute commitment cannot fit; a 180-minute commitment fits exactly.
    const oversized = plan({
      blocks,
      items: [ranked("c-big")],
      effortOf: (id) => (id === "c-big" ? 240 : 0),
    });
    expect(oversized.placements).toHaveLength(0);
    expect(oversized.unplaced).toEqual(["c-big"]);

    const exact = plan({
      blocks,
      items: [ranked("c-exact")],
      effortOf: (id) => (id === "c-exact" ? 180 : 0),
    });
    expect(exact.placements).toHaveLength(1);
    expect(exact.placements[0]).toEqual({
      commitmentId: "c-exact",
      blockIndex: 0,
      start: "2026-03-08T09:00:00.000Z",
      end: "2026-03-08T12:00:00.000Z",
    });
    expect(exact.unplaced).toHaveLength(0);
  });

  it("does not mark 01:30-23:59 busy when a meeting crosses the duplicated fall-back hour", () => {
    const blocks = freeBlocks({
      localDate: "2026-11-01",
      timeZone: LA,
      workingHours: { start: "00:00", end: "23:59" },
      meetings: [meeting({ start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:15:00Z" })],
      now: new Date("2026-10-31T12:00:00Z"),
      minMinutes: 15,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      start: "2026-11-01T07:00:00.000Z",
      end: "2026-11-01T08:30:00.000Z",
      minutes: 90,
    });
    expect(blocks[1]).toEqual({
      start: "2026-11-01T09:15:00.000Z",
      end: "2026-11-02T07:59:00.000Z",
      minutes: 1364,
    });
  });

  it("throws on an unparseable meeting start instead of reporting its time free", () => {
    const base = {
      localDate: "2026-10-20" as const,
      timeZone: LA,
      workingHours: { start: "09:00" as const, end: "17:00" as const },
      now: new Date("2026-10-19T12:00:00Z"),
      minMinutes: 15,
    };
    const template = meeting({ start: "2026-10-20T18:00:00Z", end: "2026-10-20T19:00:00Z" });
    const badMeetings: Meeting[] = [
      { ...template, start: "" },
      { ...template, start: "not-a-date" },
      { ...template, end: undefined },
    ] as unknown as Meeting[];
    for (const bad of badMeetings) {
      expect(() => freeBlocks({ ...base, meetings: [bad] })).toThrow(RangeError);
    }
  });

  it("throws on an inverted meeting interval", () => {
    expect(() =>
      freeBlocks({
        localDate: "2026-10-20",
        timeZone: LA,
        workingHours: { start: "09:00", end: "17:00" },
        meetings: [meeting({ start: "2026-10-20T17:00:00Z", end: "2026-10-20T16:00:00Z" })],
        now: new Date("2026-10-19T12:00:00Z"),
        minMinutes: 15,
      }),
    ).toThrow(RangeError);
  });

  it("treats a zero-length meeting as not busy", () => {
    const blocks = freeBlocks({
      localDate: "2026-10-20",
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [meeting({ start: "2026-10-20T12:00:00Z", end: "2026-10-20T12:00:00Z" })],
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
});
