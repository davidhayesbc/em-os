import type { Commitment, Goal, Meeting, SourceItem } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { type BuildTodayInput, buildToday } from "./build.js";

const timeZone = "UTC";
const date = "2026-10-25";
const now = new Date("2026-10-25T07:00:00.000Z");

function profile(): BuildTodayInput["profile"] {
  return {
    workingHours: { start: "09:00", end: "17:00" },
    workWeek: [1, 2, 3, 4, 5],
    rank: {
      topN: 5,
      goalSlots: 1,
      timeCriticalHours: 24,
      staleDays: 14,
      confidenceThreshold: 0.7,
      ticketDueSoonDays: 3,
      weights: {
        timeCritical: 1000,
        overduePerDay: 50,
        hardDated: 400,
        waitingPerDay: 30,
        goal: 150,
        pin: 300,
        priority: [120, 80, 40, 0],
        urgencyNow: 100,
        staleSource: 60,
        lowConfidence: 40,
      },
    },
    minFocusMinutes: 15,
    defaultEffortMinutes: 30,
  };
}

function baseCommitment(overrides: Partial<Commitment> & { title: string }): Commitment {
  const { title, ...rest } = overrides;
  return {
    id: `cmt_${title}`,
    direction: "mine",
    status: "active",
    dropReason: null,
    urgency: null,
    priority: null,
    due: null,
    tags: [],
    createdBy: "user",
    ownerId: "per_self",
    counterpartId: null,
    goalId: null,
    meetingId: null,
    title,
    notes: "",
    pinned: false,
    pinProvenance: null,
    ticketId: null,
    effortMinutes: 30,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    confidence: null,
    occurredAt: "2026-10-20T12:00:00.000Z",
    capturedAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    retentionState: "active",
    ...rest,
  };
}

function dueToday(title: string, priority: number | null = null): Commitment {
  return baseCommitment({
    title,
    priority,
    due: { date, time: null, timeZone },
  });
}

function meeting(
  start: string,
  end: string,
  classification: Meeting["classification"] = "other",
): Meeting {
  return {
    id: `mtg_${start}`,
    connectorId: "cal",
    externalId: `ext_${start}`,
    title: "Meeting",
    start,
    end,
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification,
    classificationSource: "auto",
    personId: null,
    attendees: [],
    actionItems: [],
    url: null,
    occurredAt: start,
    capturedAt: start,
    updatedAt: start,
    retentionState: "active",
  };
}

describe("buildToday", () => {
  it("returns empty state when store is empty and not onboarded", () => {
    const result = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: false,
      profile: profile(),
      commitments: [],
      meetings: [],
      goals: [],
      sourceItems: [],
      syncStates: [],
      dayPlanIds: null,
      refresh: false,
    });

    expect(result.localDate).toBe(date);
    expect(result.timeZone).toBe(timeZone);
    expect(result.onboarded).toBe(false);
    expect(result.header).toEqual({
      meetingCount: 0,
      freeMinutes: 480,
      toTriage: 0,
      lastSyncAt: null,
      failingConnectors: [],
    });
    expect(result.weekLoad).toHaveLength(5);
    expect(result.timeline.meetings).toEqual([]);
    expect(result.top).toEqual([]);
    expect(result.waitingOn).toEqual([]);
    expect(result.progress).toEqual({ done: 0, total: 0 });
  });

  it("keeps the day plan stable after completion and new urgent items", () => {
    const profileValue = profile();
    const c1 = dueToday("one");
    const c2 = dueToday("two");
    const c3 = dueToday("three");
    const c4 = dueToday("four");
    const c5 = dueToday("five");
    const c6 = baseCommitment({ title: "six", due: { date: "2026-10-26", time: null, timeZone } });

    const first = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: true,
      profile: profileValue,
      commitments: [c1, c2, c3, c4, c5, c6],
      meetings: [],
      goals: [],
      sourceItems: [],
      syncStates: [],
      dayPlanIds: null,
      refresh: false,
    });
    const firstIds = first.top.map((t) => t.commitment.id);
    expect(firstIds).toHaveLength(5);

    // Complete item 2 and add a new due-today item.
    const completedC2 = { ...c2, status: "done" as const, completedAt: now.toISOString() };
    const c7 = dueToday("seven", 0); // p0 makes it high scoring.
    const second = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: true,
      profile: profileValue,
      commitments: [c1, completedC2, c3, c4, c5, c6, c7],
      meetings: [],
      goals: [],
      sourceItems: [],
      syncStates: [],
      dayPlanIds: firstIds,
      refresh: false,
    });

    const secondIds = second.top.map((t) => t.commitment.id);
    expect(secondIds).toEqual(firstIds);
    const item2 = second.top.find((t) => t.commitment.id === c2.id);
    expect(item2?.done).toBe(true);
    expect(item2?.item).toBeNull();
    expect(second.progress).toEqual({ done: 1, total: 5 });

    // Refresh re-selects and includes the new high-priority item.
    const refreshed = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: true,
      profile: profileValue,
      commitments: [c1, completedC2, c3, c4, c5, c6, c7],
      meetings: [],
      goals: [],
      sourceItems: [],
      syncStates: [],
      dayPlanIds: firstIds,
      refresh: true,
    });
    expect(refreshed.top.map((t) => t.commitment.id)).toContain(c7.id);
  });

  it("skips unknown day plan ids and counts progress over the surviving slots", () => {
    const c1 = dueToday("one");
    const result = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: true,
      profile: profile(),
      commitments: [c1],
      meetings: [],
      goals: [],
      sourceItems: [],
      syncStates: [],
      dayPlanIds: [c1.id, "deleted_unknown_id"],
      refresh: false,
    });

    expect(result.top.map((t) => t.commitment.id)).toEqual([c1.id]);
    expect(result.progress).toEqual({ done: 0, total: 1 });
    expect(result.effectiveIds).toEqual([c1.id]);
  });

  it("sorts waitingOn by due date with nulls last", () => {
    const w1 = baseCommitment({
      title: "w1",
      direction: "owed_to_me",
      due: { date: "2026-10-24", time: null, timeZone },
    });
    const w2 = baseCommitment({
      title: "w2",
      direction: "owed_to_me",
      due: { date: "2026-10-23", time: null, timeZone },
    });
    const w3 = baseCommitment({ title: "w3", direction: "owed_to_me" });

    const result = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: true,
      profile: profile(),
      commitments: [w1, w2, w3],
      meetings: [],
      goals: [],
      sourceItems: [],
      syncStates: [],
      dayPlanIds: null,
      refresh: false,
    });

    expect(result.waitingOn.map((c) => c.id)).toEqual([w2.id, w1.id, w3.id]);
  });

  it("reports freeMinutes as the sum of plan freeBlocks", () => {
    const m = meeting("2026-10-25T10:00:00.000Z", "2026-10-25T11:00:00.000Z");
    const result = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: true,
      profile: profile(),
      commitments: [],
      meetings: [m],
      goals: [],
      sourceItems: [],
      syncStates: [],
      dayPlanIds: null,
      refresh: false,
    });

    const freeSum = result.timeline.plan.freeBlocks.reduce((s, b) => s + b.minutes, 0);
    expect(result.header.freeMinutes).toBe(freeSum);
    expect(result.header.meetingCount).toBe(1);
  });

  it("builds with a generated dataset of 30 people, 500 commitments and 200 meetings", () => {
    const people: string[] = [];
    for (let i = 0; i < 30; i += 1) people.push(`per_${i}`);

    const commitments: Commitment[] = [];
    const peopleCount = people.length;
    for (let i = 0; i < 500; i += 1) {
      const due = i % 5 === 0 ? { date, time: null, timeZone } : null;
      commitments.push(
        baseCommitment({
          title: `gen_${i}`,
          ownerId: people[i % peopleCount] ?? "per_unknown",
          direction: i % 7 === 0 ? "owed_to_me" : "mine",
          due,
          priority: i % 4,
          effortMinutes: 15 + (i % 8) * 15,
        }),
      );
    }

    const meetings: Meeting[] = [];
    for (let i = 0; i < 200; i += 1) {
      const startHour = 9 + (i % 7);
      meetings.push(
        meeting(
          `2026-10-25T${String(startHour).padStart(2, "0")}:00:00.000Z`,
          `2026-10-25T${String(startHour + 1).padStart(2, "0")}:00:00.000Z`,
          i % 5 === 0 ? "one_on_one" : "other",
        ),
      );
    }

    const goals: Goal[] = [];
    for (let i = 0; i < 10; i += 1) {
      goals.push({
        id: `goal_${i}`,
        title: `Goal ${i}`,
        slug: null,
        subjectPersonId: people[0] ?? "per_unknown",
        horizon: "quarter",
        kind: "team",
        status: "active",
        targetDate: null,
        sensitivity: "normal",
        occurredAt: "2026-10-20T12:00:00.000Z",
        capturedAt: "2026-10-20T12:00:00.000Z",
        updatedAt: "2026-10-20T12:00:00.000Z",
        retentionState: "active",
      });
    }

    const sourceItems: SourceItem[] = [];

    const result = buildToday({
      localDate: date,
      timeZone,
      now,
      onboarded: true,
      profile: profile(),
      commitments,
      meetings,
      goals,
      sourceItems,
      syncStates: [],
      dayPlanIds: null,
      refresh: false,
    });

    expect(result.top.length).toBeGreaterThan(0);
    expect(result.top.length).toBeLessThanOrEqual(5);
    expect(result.timeline.meetings.length).toBeGreaterThan(0);
    expect(result.weekLoad).toHaveLength(5);
  });
});
