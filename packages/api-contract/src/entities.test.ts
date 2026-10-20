import { describe, expect, it } from "vitest";
import type { ExternalMeeting, NewCommitment, NewPersonNote } from "./index.js";
import {
  Accomplishment,
  AuditEvent,
  Commitment,
  Decision,
  Document,
  Goal,
  Identity,
  IsoDateTime,
  LocalDate,
  Meeting,
  Person,
  PersonNote,
  Risk,
  SourceItem,
} from "./index.js";

const dated = {
  occurredAt: "2026-10-20T16:00:00.000Z",
  capturedAt: "2026-10-20T16:00:01.000Z",
  updatedAt: "2026-10-20T16:00:02.000Z",
  retentionState: "active",
} as const;

const basePerson = {
  ...dated,
  id: "p1",
  displayName: "Alex Rivera",
  relationship: "direct_report",
  pronouns: "they/them",
  aliases: ["Alex"],
  role: "Engineer",
  timeZone: "America/Vancouver",
  archived: false,
  oneOnOneCadenceDays: 7,
};

const baseNoteWithoutSensitivity = {
  ...dated,
  id: "n1",
  personId: "p1",
  text: "Led the migration review.",
  tags: ["growth"],
  sourceUrl: null,
  origin: "manual",
};

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

describe("common", () => {
  it("rejects non-UTC timestamps", () => {
    expect(IsoDateTime.safeParse("2026-10-20T09:00:00-07:00").success).toBe(false);
    expect(IsoDateTime.safeParse("2026-10-20T09:00:00").success).toBe(false);
    expect(IsoDateTime.safeParse("2026-10-20T16:00:00.000Z").success).toBe(true);
    expect(IsoDateTime.safeParse("2026-10-20T16:00:00Z").success).toBe(true);
  });

  it("local dates are YYYY-MM-DD only", () => {
    expect(LocalDate.safeParse("2026-10-20").success).toBe(true);
    expect(LocalDate.safeParse("2026-10-20T00:00:00Z").success).toBe(false);
  });

  it("rejects an unknown retention state", () => {
    expect(Person.safeParse({ ...basePerson, retentionState: "deleted" }).success).toBe(false);
  });
});

describe("Person", () => {
  it("parses a full person", () => {
    expect(Person.parse(basePerson).displayName).toBe("Alex Rivera");
  });

  it("pronouns may be null (unknown)", () => {
    expect(Person.parse({ ...basePerson, pronouns: null }).pronouns).toBeNull();
  });

  it("cadence must be a positive integer or null", () => {
    expect(Person.safeParse({ ...basePerson, oneOnOneCadenceDays: 0 }).success).toBe(false);
    expect(Person.safeParse({ ...basePerson, oneOnOneCadenceDays: null }).success).toBe(true);
  });

  it("rejects an unknown relationship", () => {
    expect(Person.safeParse({ ...basePerson, relationship: "friend" }).success).toBe(false);
  });
});

describe("Identity", () => {
  it("parses an identity", () => {
    const i = Identity.parse({
      ...dated,
      id: "i1",
      personId: "p1",
      source: "chat",
      handle: "alex.rivera",
      confirmed: false,
    });
    expect(i.confirmed).toBe(false);
  });
});

describe("PersonNote", () => {
  it("defaults to people_sensitive and accepted", () => {
    const n = PersonNote.parse(baseNoteWithoutSensitivity);
    expect(n.sensitivity).toBe("people_sensitive");
    expect(n.reviewState).toBe("accepted");
  });

  it("keeps an explicit proposed review state (MCP notes)", () => {
    expect(
      PersonNote.parse({ ...baseNoteWithoutSensitivity, origin: "mcp", reviewState: "proposed" })
        .reviewState,
    ).toBe("proposed");
  });

  it("NewPersonNote makes occurredAt and retentionState optional", () => {
    const n: NewPersonNote = {
      personId: "p1",
      text: "t",
      tags: [],
      sourceUrl: null,
      sensitivity: "private",
      origin: "manual",
      reviewState: "accepted",
    };
    expect(n.text).toBe("t");
  });
});

describe("Goal", () => {
  it("parses a goal with a nullable slug and target date", () => {
    const g = Goal.parse({
      ...dated,
      id: "g1",
      title: "Ship the platform migration",
      slug: null,
      subjectPersonId: "p0",
      horizon: "quarter",
      kind: "project",
      status: "active",
      targetDate: null,
      sensitivity: "normal",
    });
    expect(g.slug).toBeNull();
  });
});

describe("Commitment", () => {
  it("parses a minimal commitment", () => {
    expect(Commitment.parse(baseCommitment).title).toBe("Send the review");
  });

  it("priority is 0..3 or null", () => {
    expect(Commitment.safeParse({ ...baseCommitment, priority: 3 }).success).toBe(true);
    expect(Commitment.safeParse({ ...baseCommitment, priority: 4 }).success).toBe(false);
    expect(Commitment.safeParse({ ...baseCommitment, priority: 1.5 }).success).toBe(false);
  });

  it("parses due and recurrence", () => {
    const c = Commitment.parse({
      ...baseCommitment,
      due: { date: "2026-10-23", time: null, timeZone: "America/Vancouver" },
      recurrence: { freq: "weekly", interval: 1, byWeekday: [1, 3], byMonthDay: null },
      seriesId: "s1",
    });
    expect(c.recurrence?.freq).toBe("weekly");
    expect(c.due?.date).toBe("2026-10-23");
  });

  it("rejects an unknown status and a non-UTC snoozedUntil", () => {
    expect(Commitment.safeParse({ ...baseCommitment, status: "open" }).success).toBe(false);
    expect(
      Commitment.safeParse({ ...baseCommitment, snoozedUntil: "2026-10-20T09:00:00-07:00" })
        .success,
    ).toBe(false);
  });

  it("NewCommitment omits id and system timestamps", () => {
    const { id: _id, capturedAt: _c, updatedAt: _u, ...rest } = Commitment.parse(baseCommitment);
    const n: NewCommitment = rest;
    expect(n.title).toBe("Send the review");
    const { occurredAt: _o, retentionState: _r, ...withoutOptional } = rest;
    const m: NewCommitment = withoutOptional;
    expect(m.title).toBe("Send the review");
  });
});

describe("Meeting", () => {
  const baseMeeting = {
    ...dated,
    id: "m1",
    connectorId: "calendar-1",
    externalId: "evt-1",
    title: "1:1 Alex / Sam",
    start: "2026-10-21T17:00:00.000Z",
    end: "2026-10-21T17:30:00.000Z",
    allDay: false,
    status: "confirmed",
    selfResponse: null,
    classification: "one_on_one",
    classificationSource: "auto",
    personId: "p1",
    attendees: [
      { identityId: null, personId: "p1", displayName: "Alex Rivera", email: "alex@example.com" },
    ],
    actionItems: [{ text: "Share the doc", ownerName: "Alex Rivera", done: false }],
    url: null,
  };

  it("parses a meeting", () => {
    expect(Meeting.parse(baseMeeting).attendees).toHaveLength(1);
  });

  it("rejects an unknown classification", () => {
    expect(Meeting.safeParse({ ...baseMeeting, classification: "all_hands" }).success).toBe(false);
  });

  it("ExternalMeeting requires connectorId and externalId", () => {
    const { id: _id, capturedAt: _c, updatedAt: _u, ...rest } = Meeting.parse(baseMeeting);
    const m: ExternalMeeting = rest;
    expect(m.externalId).toBe("evt-1");
  });
});

describe("SourceItem", () => {
  it("parses a source item with sections", () => {
    const s = SourceItem.parse({
      ...dated,
      id: "s1",
      connectorId: "chat-1",
      externalId: "msg-1",
      kind: "message",
      origin: "connector",
      url: null,
      authorIdentityId: null,
      text: "hello",
      contentHash: "abc",
      sensitivity: "normal",
      sections: [{ heading: "2026-09", sensitivity: "normal", startLine: 0 }],
    });
    expect(s.sections?.[0]?.startLine).toBe(0);
  });
});

describe("risk, decision, document, accomplishment", () => {
  it("parse", () => {
    expect(
      Risk.parse({
        ...dated,
        id: "r1",
        title: "Vendor slip",
        status: "open",
        ownerId: null,
        links: [],
        sourceItemIds: [],
      }).title,
    ).toBe("Vendor slip");
    expect(
      Decision.parse({
        ...dated,
        id: "d1",
        title: "Adopt the new queue",
        status: "decided",
        ownerId: "p0",
        links: ["https://example.com/adr/1"],
        sourceItemIds: ["s1"],
      }).status,
    ).toBe("decided");
    expect(
      Document.parse({
        ...dated,
        id: "doc1",
        connectorId: "docs-1",
        url: "https://example.com/doc",
        title: "Brag doc",
        ownerPersonId: "p1",
        kind: "brag_doc",
        sharedWithMe: true,
        lastModified: "2026-10-01T00:00:00.000Z",
      }).sharedWithMe,
    ).toBe(true);
    expect(
      Accomplishment.parse({
        ...dated,
        id: "a1",
        subjectPersonId: "p1",
        summary: "Shipped X",
        impact: null,
        tags: ["ownership"],
        sourceItemIds: [],
        sensitivity: "people_sensitive",
        status: "proposed",
      }).status,
    ).toBe("proposed");
  });
});

describe("AuditEvent", () => {
  it("parses an audit event", () => {
    const e = AuditEvent.parse({
      id: "e1",
      entity: "commitment",
      entityId: "c1",
      action: "update",
      actor: "mcp",
      at: "2026-10-20T16:00:00.000Z",
      note: null,
      diff: { status: { from: "proposed", to: "active" } },
    });
    expect(e.diff.status?.to).toBe("active");
  });
});
