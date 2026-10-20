// Field-level validation that the base entity tests don't cover: impossible dates, wall-clock
// times, IANA zones, effort bounds and audit diffs.
import { describe, expect, it } from "vitest";
import {
  AuditEvent,
  Commitment,
  CommitmentDue,
  isValidTimeZone,
  LocalDate,
  LocalTime,
  Person,
  TimeZone,
} from "./index.js";

const dated = {
  occurredAt: "2026-10-20T16:00:00.000Z",
  capturedAt: "2026-10-20T16:00:01.000Z",
  updatedAt: "2026-10-20T16:00:02.000Z",
  retentionState: "active",
} as const;

const baseCommitment = {
  ...dated,
  id: "c1",
  direction: "mine",
  status: "active",
  dropReason: null,
  urgency: null,
  priority: null,
  due: null,
  tags: [],
  createdBy: "user",
  ownerId: "p0",
  counterpartId: null,
  goalId: null,
  meetingId: null,
  title: "Send the review",
  notes: "",
  pinned: false,
  effortMinutes: null,
  snoozedUntil: null,
  completedAt: null,
  recurrence: null,
  seriesId: null,
};

const basePerson = {
  ...dated,
  id: "p1",
  displayName: "Alex Rivera",
  relationship: "direct_report",
  pronouns: "they/them",
  aliases: [],
  role: null,
  timeZone: "America/Vancouver",
  archived: false,
  oneOnOneCadenceDays: null,
};

const due = (over: Partial<{ date: string; time: string | null; timeZone: string }>) => ({
  date: "2026-10-23",
  time: null,
  timeZone: "America/Vancouver",
  ...over,
});

describe("LocalDate rejects impossible dates", () => {
  it.each(["2026-02-28", "2028-02-29", "2026-12-31", "2026-01-01", "0001-01-01"])(
    "accepts %s",
    (d) => {
      expect(LocalDate.safeParse(d).success).toBe(true);
    },
  );

  it.each([
    "2026-02-29", // not a leap year
    "2100-02-29", // century, not a leap year
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
    "2026-10-32",
  ])("rejects %s", (d) => {
    expect(LocalDate.safeParse(d).success).toBe(false);
  });
});

describe("due.time is HH:MM (24 h) or null", () => {
  it.each(["00:00", "09:30", "19:59", "23:59"])("accepts %s", (t) => {
    expect(LocalTime.safeParse(t).success).toBe(true);
    expect(CommitmentDue.safeParse(due({ time: t })).success).toBe(true);
  });

  it.each(["24:00", "9:30", "09:60", "09:30:00", "0930", "", " 09:30", "ab:cd"])(
    "rejects %j",
    (t) => {
      expect(CommitmentDue.safeParse(due({ time: t })).success).toBe(false);
    },
  );

  it("null means all day", () => {
    expect(CommitmentDue.parse(due({ time: null })).time).toBeNull();
  });
});

describe("timeZone fields are IANA zones", () => {
  it.each(["America/Vancouver", "Europe/London", "Asia/Kolkata", "UTC"])("accepts %s", (z) => {
    expect(TimeZone.safeParse(z).success).toBe(true);
    expect(CommitmentDue.safeParse(due({ timeZone: z })).success).toBe(true);
    expect(Person.safeParse({ ...basePerson, timeZone: z }).success).toBe(true);
  });

  it.each(["Mars/Olympus_Mons", "PST8PDTX", "", "not a zone", "+25:00"])("rejects %j", (z) => {
    expect(TimeZone.safeParse(z).success).toBe(false);
    expect(CommitmentDue.safeParse(due({ timeZone: z })).success).toBe(false);
    expect(Person.safeParse({ ...basePerson, timeZone: z }).success).toBe(false);
  });

  it("a person's zone may still be null (unknown)", () => {
    expect(Person.safeParse({ ...basePerson, timeZone: null }).success).toBe(true);
  });

  it("caches the answer per zone (Intl is consulted once)", () => {
    const calls: string[] = [];
    const RealDTF = Intl.DateTimeFormat;
    const spy = function (this: unknown, ...args: ConstructorParameters<typeof RealDTF>) {
      calls.push(String(args[1]?.timeZone));
      return new RealDTF(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Intl.DateTimeFormat = spy;
    try {
      const zone = "Pacific/Chatham";
      isValidTimeZone(zone);
      isValidTimeZone(zone);
      isValidTimeZone(zone);
      expect(calls.filter((c) => c === zone)).toHaveLength(1);
    } finally {
      Intl.DateTimeFormat = RealDTF;
    }
  });
});

describe("effortMinutes is an integer 1..1440 or null", () => {
  it.each([1, 30, 1440, null])("accepts %j", (m) => {
    expect(Commitment.safeParse({ ...baseCommitment, effortMinutes: m }).success).toBe(true);
  });

  it.each([0, -5, 1441, 1.5, Number.NaN])("rejects %j", (m) => {
    expect(Commitment.safeParse({ ...baseCommitment, effortMinutes: m }).success).toBe(false);
  });
});

describe("AuditEvent.diff uses null, never undefined", () => {
  const event = (diff: unknown) => ({
    id: "e1",
    entity: "commitment",
    entityId: "c1",
    action: "update",
    actor: "user",
    at: "2026-10-20T16:00:00.000Z",
    note: null,
    diff,
  });

  it("accepts null for a field that was or became empty", () => {
    expect(AuditEvent.safeParse(event({ dropReason: { from: null, to: "user" } })).success).toBe(
      true,
    );
    expect(AuditEvent.safeParse(event({ dueDate: { from: "2026-10-23", to: null } })).success).toBe(
      true,
    );
  });

  it("rejects an undefined or missing from/to (it would vanish from the JSON)", () => {
    expect(
      AuditEvent.safeParse(event({ dropReason: { from: undefined, to: "user" } })).success,
    ).toBe(false);
    expect(AuditEvent.safeParse(event({ dropReason: { to: "user" } })).success).toBe(false);
    expect(AuditEvent.safeParse(event({ dropReason: { from: null } })).success).toBe(false);
  });
});
