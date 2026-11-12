import type { Commitment, Meeting } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { weekLoad } from "./week-load.js";

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

function commitment(overrides: Partial<Commitment> & { id: string; title: string }): Commitment {
  const now = "2026-10-19T12:00:00Z";
  const base: Commitment = {
    id: overrides.id,
    direction: "mine",
    status: "active",
    dropReason: null,
    urgency: "next",
    priority: 1,
    due: null,
    tags: [],
    createdBy: "user",
    ownerId: "self",
    counterpartId: null,
    goalId: null,
    meetingId: null,
    title: overrides.title,
    notes: "",
    pinned: false,
    pinProvenance: null,
    ticketId: null,
    effortMinutes: 60,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    confidence: null,
    occurredAt: now,
    capturedAt: now,
    updatedAt: now,
    retentionState: "active",
  };
  return { ...base, ...overrides };
}

const monTueWedThuFri = [1, 2, 3, 4, 5] as const;

function workWeekParams(overrides: {
  weekOf?: string;
  workWeek?: readonly number[];
  meetings?: Meeting[];
  commitments?: Commitment[];
  workingHours?: { start: string; end: string };
}) {
  return {
    weekOf: overrides.weekOf ?? "2026-10-21",
    workWeek: overrides.workWeek ? [...overrides.workWeek] : [...monTueWedThuFri],
    timeZone: LA,
    workingHours: overrides.workingHours ?? { start: "09:00", end: "17:00" },
    meetings: overrides.meetings ?? [],
    commitments: overrides.commitments ?? [],
  };
}

describe("weekLoad", () => {
  it("marks a Thursday with six hours of meetings as overloaded", () => {
    const loads = weekLoad(
      workWeekParams({
        meetings: [meeting({ start: "2026-10-22T16:00:00Z", end: "2026-10-22T22:00:00Z" })],
      }),
    );

    expect(loads).toHaveLength(5);
    const thu = loads.find((d) => d.date === "2026-10-22");
    expect(thu).toBeDefined();
    expect(thu?.meetingMinutes).toBe(360);
    expect(thu?.workingMinutes).toBe(480);
    expect(thu?.loadRatio).toBe(0.75);
    expect(thu?.overloaded).toBe(true);
  });

  it("dst week starts on Sunday and places a 09:00 meeting on the fall-back day", () => {
    const loads = weekLoad({
      weekOf: "2026-11-03",
      workWeek: [0, 1, 2, 3, 4], // Sun-Thu
      timeZone: LA,
      workingHours: { start: "09:00", end: "17:00" },
      meetings: [
        meeting({
          id: "dst-meeting",
          start: "2026-11-01T17:00:00Z", // 09:00 PST (10:00 PDT before fall-back)
          end: "2026-11-01T18:00:00Z",
          title: "Sunday standup",
        }),
      ],
      commitments: [],
    });

    expect(loads).toHaveLength(5);
    expect(loads.map((d) => d.date)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);

    const sunday = loads.find((d) => d.date === "2026-11-01");
    expect(sunday).toBeDefined();
    expect(sunday?.meetingMinutes).toBe(60);
    expect(sunday?.workingMinutes).toBe(480);
    expect(sunday?.loadRatio).toBe(60 / 480);
    expect(sunday?.overloaded).toBe(false);
  });

  it("shows an active mine commitment under its due day", () => {
    const loads = weekLoad(
      workWeekParams({
        commitments: [
          commitment({
            id: "c-wed",
            title: "Wednesday deliverable",
            due: { date: "2026-10-21", time: null, timeZone: LA },
          }),
          commitment({
            id: "c-theirs",
            title: "Delegated item",
            direction: "owed_to_me",
            due: { date: "2026-10-21", time: null, timeZone: LA },
          }),
          commitment({
            id: "c-done",
            title: "Already done",
            status: "done",
            due: { date: "2026-10-21", time: null, timeZone: LA },
          }),
        ],
      }),
    );

    const wed = loads.find((d) => d.date === "2026-10-21");
    expect(wed).toBeDefined();
    expect(wed?.due).toEqual([{ commitmentId: "c-wed", title: "Wednesday deliverable" }]);

    for (const day of loads.filter((d) => d.date !== "2026-10-21")) {
      expect(day.due).toHaveLength(0);
    }
  });

  it("starts a Mon-Fri week of 2026-10-21 on 2026-10-19", () => {
    const loads = weekLoad(workWeekParams({}));

    expect(loads).toHaveLength(5);
    expect(loads[0]?.date).toBe("2026-10-19");
    expect(loads.map((d) => d.date)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    for (const day of loads) {
      expect(day.meetingMinutes).toBe(0);
      expect(day.workingMinutes).toBe(480);
      expect(day.loadRatio).toBe(0);
      expect(day.overloaded).toBe(false);
      expect(day.due).toHaveLength(0);
    }
  });

  it("enumerates the listed workWeek days, not consecutive calendar days", () => {
    const loads = weekLoad(
      workWeekParams({
        workWeek: [1, 3, 5], // Mon/Wed/Fri
        weekOf: "2026-10-21",
      }),
    );

    expect(loads.map((d) => d.date)).toEqual([
      "2026-10-19", // Mon
      "2026-10-21", // Wed
      "2026-10-23", // Fri
    ]);
    expect(loads.some((d) => d.date === "2026-10-20")).toBe(false);
  });

  it("collapses duplicate workWeek days", () => {
    const loads = weekLoad(
      workWeekParams({
        workWeek: [1, 1, 2], // Mon, Mon, Tue
        weekOf: "2026-10-21",
      }),
    );

    expect(loads.map((d) => d.date)).toEqual(["2026-10-19", "2026-10-20"]);
  });

  it("only counts confirmed accepted non-all-day meetings as busy", () => {
    const loads = weekLoad(
      workWeekParams({
        meetings: [
          meeting({ id: "confirmed", start: "2026-10-21T17:00:00Z", end: "2026-10-21T18:00:00Z" }), // 09:00-10:00 LA
          meeting({
            id: "tentative",
            selfResponse: "tentative",
            start: "2026-10-21T18:00:00Z",
            end: "2026-10-21T19:00:00Z",
          }),
          meeting({
            id: "declined",
            selfResponse: "declined",
            start: "2026-10-21T19:00:00Z",
            end: "2026-10-21T20:00:00Z",
          }),
          meeting({
            id: "all-day",
            allDay: true,
            start: "2026-10-21T07:00:00Z",
            end: "2026-10-22T07:00:00Z",
          }),
        ],
      }),
    );

    const wed = loads.find((d) => d.date === "2026-10-21");
    expect(wed).toBeDefined();
    expect(wed?.meetingMinutes).toBe(60);
  });

  it("clips meeting minutes to the working-hours window", () => {
    const loads = weekLoad(
      workWeekParams({
        meetings: [
          meeting({ start: "2026-10-21T13:00:00Z", end: "2026-10-21T14:00:00Z" }), // 06:00-07:00 LA
          meeting({ start: "2026-10-21T23:30:00Z", end: "2026-10-22T01:30:00Z" }), // 16:30-18:30 LA
        ],
      }),
    );

    const wed = loads.find((d) => d.date === "2026-10-21");
    expect(wed).toBeDefined();
    expect(wed?.meetingMinutes).toBe(30);
  });

  it("counts physical duration across a DST fall-back working window", () => {
    const loads = weekLoad({
      weekOf: "2026-11-01",
      workWeek: [0], // Sunday
      timeZone: LA,
      workingHours: { start: "00:00", end: "04:00" },
      meetings: [],
      commitments: [],
    });

    expect(loads).toHaveLength(1);
    expect(loads[0]?.date).toBe("2026-11-01");
    expect(loads[0]?.workingMinutes).toBe(300);
  });
});
