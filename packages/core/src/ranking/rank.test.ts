import type { Commitment, Goal, Meeting } from "@emos/api-contract";
import { DEFAULT_PROFILE } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { rank, selectTop } from "./rank.js";

const TIME_ZONE = "America/Los_Angeles";
const NOON_TODAY = new Date("2026-10-29T19:00:00.000Z"); // 12:00 PDT, Thu Oct 29
const MORNING_TODAY = new Date("2026-10-29T16:00:00.000Z"); // 09:00 PDT

const config = { ...DEFAULT_PROFILE.rank, topN: 5, goalSlots: 1 };

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: "c_default",
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
    title: "Default commitment",
    notes: "",
    pinned: false,
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    occurredAt: "2026-10-20T12:00:00.000Z",
    capturedAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
    retentionState: "active",
    ...overrides,
  };
}

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: "m_default",
    connectorId: "cal_test",
    externalId: "ext_default",
    title: "Standup",
    start: "2026-10-29T20:00:00.000Z", // 1pm PDT
    end: "2026-10-29T20:30:00.000Z",
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification: "standup",
    classificationSource: "auto",
    personId: null,
    attendees: [],
    actionItems: [],
    url: null,
    occurredAt: "2026-10-29T12:00:00.000Z",
    capturedAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
    retentionState: "active",
    ...overrides,
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g_default",
    title: "Ship the dashboard",
    slug: null,
    subjectPersonId: "per_self",
    horizon: "quarter",
    kind: "team",
    status: "active",
    targetDate: null,
    sensitivity: "normal",
    occurredAt: "2026-10-01T12:00:00.000Z",
    capturedAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
    retentionState: "active",
    ...overrides,
  };
}

describe("rank", () => {
  it("returns an empty array for no commitments", () => {
    expect(rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [], meetings: [], goals: [], config })).toEqual([]);
  });

  it("prep for a 1pm meeting today outranks an item due in 3 days", () => {
    const mtg = meeting({ id: "m1" });
    const a = commitment({ id: "a", meetingId: "m1" });
    const b = commitment({ id: "b", due: { date: "2026-11-01", time: null, timeZone: TIME_ZONE } });
    const result = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a, b], meetings: [mtg], goals: [], config });
    expect(result.map((r) => r!.commitmentId)).toEqual(["a", "b"]);
    expect(result[0]!.why).toBe("meeting 1pm");
    expect(result[0]!.dominant).toBe("time_critical");
  });

  it("formats meeting times with non-zero minutes", () => {
    const mtg = meeting({ id: "m1", start: "2026-10-29T16:30:00.000Z", end: "2026-10-29T17:00:00.000Z" }); // 9:30am PDT
    const a = commitment({ id: "a", meetingId: "m1" });
    const [r] = rank({ now: MORNING_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [mtg], goals: [], config });
    expect(r!.why).toBe("meeting 9:30am");
  });

  it("due today outranks due in 3 days", () => {
    const a = commitment({ id: "a", due: { date: "2026-10-29", time: null, timeZone: TIME_ZONE } });
    const b = commitment({ id: "b", due: { date: "2026-11-01", time: null, timeZone: TIME_ZONE } });
    const result = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a, b], meetings: [], goals: [], config });
    expect(result.map((r) => r!.commitmentId)).toEqual(["a", "b"]);
    expect(result[0]!.why).toBe("due today");
    expect(result[0]!.dominant).toBe("time_critical");
  });

  it("overdue 2d outranks due today", () => {
    const a = commitment({ id: "a", due: { date: "2026-10-27", time: null, timeZone: TIME_ZONE } });
    const b = commitment({ id: "b", due: { date: "2026-10-29", time: null, timeZone: TIME_ZONE } });
    const result = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a, b], meetings: [], goals: [], config });
    expect(result.map((r) => r!.commitmentId)).toEqual(["a", "b"]);
    expect(result[0]!.why).toBe("overdue 2d");
    expect(result[0]!.dominant).toBe("time_critical");
  });

  it("due tomorrow is time-critical", () => {
    const a = commitment({ id: "a", due: { date: "2026-10-30", time: null, timeZone: TIME_ZONE } });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(r!.why).toBe("due tomorrow");
  });

  it("future hard-dated due uses 'due Mon' within 6 days", () => {
    const a = commitment({ id: "a", due: { date: "2026-11-02", time: null, timeZone: TIME_ZONE } }); // Mon
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(r!.why).toBe("due Mon");
    expect(r!.dominant).toBe("hard_dated");
  });

  it("future hard-dated due uses 'due Nov 15' beyond 6 days", () => {
    const a = commitment({ id: "a", due: { date: "2026-11-15", time: null, timeZone: TIME_ZONE } });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(r!.why).toBe("due Nov 15");
    expect(r!.dominant).toBe("hard_dated");
  });

  it("waiting on you 4d outranks an undated p2", () => {
    const a = commitment({
      id: "a",
      counterpartId: "per_other",
      occurredAt: "2026-10-25T19:00:00.000Z",
      capturedAt: "2026-10-25T19:00:00.000Z",
    });
    const b = commitment({ id: "b", priority: 2 });
    const result = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a, b], meetings: [], goals: [], config });
    expect(result.map((r) => r!.commitmentId)).toEqual(["a", "b"]);
    expect(result[0]!.why).toBe("waiting on you 4d");
    expect(result[0]!.dominant).toBe("waiting_on_me");
  });

  it("active goal-linked item exposes the goal chip", () => {
    const g = goal({ id: "g1", title: "Improve onboarding flow" });
    const a = commitment({ id: "a", goalId: "g1" });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [g], config });
    expect(r!.why).toBe("advances Improve onboarding f…");
    expect(r!.dominant).toBe("goal");
  });

  it("truncates long goal titles", () => {
    const g = goal({ id: "g1", title: "This is a very long quarterly goal title" });
    const a = commitment({ id: "a", goalId: "g1" });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [g], config });
    expect(r!.why).toBe("advances This is a very long …");
  });

  it("inactive goals do not score", () => {
    const g = goal({ id: "g1", status: "dropped" });
    const a = commitment({ id: "a", goalId: "g1" });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [g], config });
    expect(r!.score).toBe(0);
  });

  it("pin dominates priority and urgency", () => {
    const a = commitment({ id: "a", pinned: true, priority: 0, urgency: "now" });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(r!.why).toBe("pinned");
    expect(r!.dominant).toBe("pin");
  });

  it("priority p0 chip", () => {
    const a = commitment({ id: "a", priority: 0 });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(r!.why).toBe("p0");
    expect(r!.dominant).toBe("priority");
  });

  it("urgency now chip", () => {
    const a = commitment({ id: "a", urgency: "now" });
    const [r] = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(r!.why).toBe("now");
    expect(r!.dominant).toBe("urgency");
  });

  it("snoozed until tomorrow is excluded; snoozed until yesterday is included", () => {
    const tomorrowMidnight = "2026-10-30T07:00:00.000Z";
    const yesterdayMidnight = "2026-10-28T07:00:00.000Z";
    const a = commitment({ id: "a", status: "snoozed", snoozedUntil: tomorrowMidnight, priority: 0 });
    const b = commitment({ id: "b", status: "snoozed", snoozedUntil: yesterdayMidnight, priority: 0 });
    const result = rank({
      now: NOON_TODAY,
      timeZone: TIME_ZONE,
      commitments: [a, b],
      meetings: [],
      goals: [],
      config,
    });
    expect(result.map((r) => r!.commitmentId)).toEqual(["b"]);
  });

  it("owed_to_me is never ranked", () => {
    const a = commitment({ id: "a", direction: "owed_to_me", priority: 0 });
    const result = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(result).toHaveLength(0);
  });

  it("proposed, done and dropped commitments are not ranked", () => {
    const proposed = commitment({ id: "proposed", status: "proposed" });
    const done = commitment({ id: "done", status: "done" });
    const dropped = commitment({ id: "dropped", status: "dropped", dropReason: "user" });
    const result = rank({
      now: NOON_TODAY,
      timeZone: TIME_ZONE,
      commitments: [proposed, done, dropped],
      meetings: [],
      goals: [],
      config,
    });
    expect(result).toHaveLength(0);
  });

  it("tie-break is deterministic under shuffled inputs", () => {
    const items: Commitment[] = [];
    for (let i = 0; i < 5; i++) {
      items.push(
        commitment({
          id: `c-${String(i).padStart(2, "0")}`,
          priority: 2,
          due: { date: "2026-11-01", time: null, timeZone: TIME_ZONE },
          capturedAt: `2026-10-20T12:00:${String(10 + i).padStart(2, "0")}.000Z`,
        }),
      );
    }
    const run = (order: Commitment[]) =>
      rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: order, meetings: [], goals: [], config }).map(
        (r) => r!.commitmentId,
      );

    const forwards = run([...items]);
    const shuffled = run([...items].reverse());
    expect(forwards).toEqual(shuffled);
    expect(forwards).toEqual(["c-00", "c-01", "c-02", "c-03", "c-04"]);
  });

  it("null due dates sort after dated ties", () => {
    const a = commitment({ id: "a", priority: 2, capturedAt: "2026-10-20T12:00:01.000Z" });
    const b = commitment({
      id: "b",
      priority: 2,
      due: { date: "2026-11-01", time: null, timeZone: TIME_ZONE },
      capturedAt: "2026-10-20T12:00:02.000Z",
    });
    const result = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: [a, b], meetings: [], goals: [], config });
    expect(result.map((r) => r!.commitmentId)).toEqual(["b", "a"]);
  });

  it("respects the display time zone for due today across a UTC midnight", () => {
    const lateNight = new Date("2026-10-30T06:30:00.000Z"); // 23:30 PDT Oct 29
    const a = commitment({ id: "a", due: { date: "2026-10-29", time: null, timeZone: TIME_ZONE } });
    const [r] = rank({ now: lateNight, timeZone: TIME_ZONE, commitments: [a], meetings: [], goals: [], config });
    expect(r!.why).toBe("due today");
  });
});

describe("selectTop", () => {
  function toMap(items: Commitment[]) {
    return new Map(items.map((c) => [c.id, c]));
  }

  it("takes topN items", () => {
    const items = Array.from({ length: 7 }, (_, i) => commitment({ id: `c${i}`, priority: i < 2 ? 0 : 1, capturedAt: `2026-10-20T12:00:0${i}.000Z` }));
    const ranked = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: items, meetings: [], goals: [], config });
    const top = selectTop(ranked, toMap(items), config);
    expect(top).toHaveLength(5);
    expect(top.map((r) => r!.commitmentId)).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  });

  it("replaces the last slot with the best goal-linked item when no goal is in the top 5", () => {
    const g = goal({ id: "g1", title: "Goal A" });
    const nonGoals = Array.from({ length: 5 }, (_, i) =>
      commitment({ id: `c${i}`, pinned: true, capturedAt: `2026-10-20T12:00:0${i}.000Z` }),
    );
    const goalItem = commitment({ id: "cg", goalId: "g1", priority: 1, capturedAt: "2026-10-20T12:00:10.000Z" });
    const items = [...nonGoals, goalItem];
    const ranked = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: items, meetings: [], goals: [g], config });
    const top = selectTop(ranked, toMap(items), config);
    expect(top.map((r) => r!.commitmentId)).toEqual(["c0", "c1", "c2", "c3", "cg"]);
  });

  it("excludes later/someday undated items from the top 5", () => {
    const a = commitment({ id: "a", urgency: "later" });
    const b = commitment({ id: "b", urgency: "someday" });
    const c = commitment({ id: "c", priority: 2 });
    const items = [a, b, c];
    const ranked = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: items, meetings: [], goals: [], config });
    expect(ranked.map((r) => r!.commitmentId)).toContain("a");
    expect(ranked.map((r) => r!.commitmentId)).toContain("b");
    const top = selectTop(ranked, toMap(items), config);
    expect(top.map((r) => r!.commitmentId)).toEqual(["c"]);
  });

  it("keeps later/someday items that have a due date", () => {
    const a = commitment({
      id: "a",
      urgency: "later",
      due: { date: "2026-10-29", time: null, timeZone: TIME_ZONE },
    });
    const items = [a];
    const ranked = rank({ now: NOON_TODAY, timeZone: TIME_ZONE, commitments: items, meetings: [], goals: [], config });
    const top = selectTop(ranked, toMap(items), config);
    expect(top.map((r) => r!.commitmentId)).toEqual(["a"]);
  });
});
