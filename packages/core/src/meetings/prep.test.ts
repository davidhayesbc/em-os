import type { Commitment, Meeting, Person, SourceItem } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { buildPrep } from "./prep.js";

const at = "2026-10-25T00:00:00.000Z";

function person(id: string): Person {
  return {
    id,
    displayName: "Alex Rivera",
    relationship: "peer",
    pronouns: null,
    aliases: [],
    role: "Engineer",
    timeZone: null,
    archived: false,
    oneOnOneCadenceDays: null,
    occurredAt: at,
    capturedAt: at,
    updatedAt: at,
    retentionState: "active",
  };
}

function commitment(overrides: Partial<Commitment> & { id: string }): Commitment {
  const { id, ...rest } = overrides;
  return {
    id,
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
    title: "Commitment",
    notes: "",
    pinned: false,
    pinProvenance: null,
    ticketId: null,
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    confidence: null,
    occurredAt: at,
    capturedAt: at,
    updatedAt: at,
    retentionState: "active",
    ...rest,
  };
}

function meeting(overrides: Partial<Meeting> & { id: string }): Meeting {
  const { id, ...rest } = overrides;
  return {
    id,
    connectorId: "cal",
    externalId: `ext-${id}`,
    title: "1:1",
    start: "2026-10-25T10:00:00.000Z",
    end: "2026-10-25T10:30:00.000Z",
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification: "one_on_one",
    classificationSource: "auto",
    personId: "per_alex",
    attendees: [],
    actionItems: [],
    url: null,
    occurredAt: at,
    capturedAt: at,
    updatedAt: at,
    retentionState: "active",
    ...rest,
  };
}

function sourceItem(overrides: Partial<SourceItem> & { id: string; text: string }): SourceItem {
  const { id, text, ...rest } = overrides;
  return {
    id,
    connectorId: "manual",
    externalId: `note-${id}`,
    kind: "note",
    origin: "manual",
    url: null,
    authorIdentityId: null,
    text,
    contentHash: text,
    sensitivity: "people_sensitive",
    sections: null,
    ticket: null,
    occurredAt: at,
    capturedAt: at,
    updatedAt: at,
    retentionState: "active",
    ...rest,
  };
}

describe("buildPrep", () => {
  const alex = person("per_alex");

  it("returns nothing_linked when no linked commitments", () => {
    const prep = buildPrep({
      meeting: meeting({ id: "mtg_now" }),
      person: alex,
      commitments: [],
      previous: null,
      previousNotes: [],
    });
    expect(prep.status).toBe("nothing_linked");
    expect(prep.linked).toEqual([]);
    expect(prep.openMine).toEqual([]);
    expect(prep.openTheirs).toEqual([]);
  });

  it("marks needs_work when a linked commitment is active", () => {
    const prep = buildPrep({
      meeting: meeting({ id: "mtg_now" }),
      person: alex,
      commitments: [
        commitment({ id: "c1", meetingId: "mtg_now", status: "active", counterpartId: "per_alex" }),
      ],
      previous: null,
      previousNotes: [],
    });
    expect(prep.status).toBe("needs_work");
    expect(prep.linked.map((c) => c.id)).toEqual(["c1"]);
  });

  it("marks ready when every linked commitment is done", () => {
    const prep = buildPrep({
      meeting: meeting({ id: "mtg_now" }),
      person: alex,
      commitments: [
        commitment({ id: "c1", meetingId: "mtg_now", status: "done", counterpartId: "per_alex" }),
      ],
      previous: null,
      previousNotes: [],
    });
    expect(prep.status).toBe("ready");
  });

  it("lists open mine and owed_to_me commitments with the counterpart", () => {
    const prep = buildPrep({
      meeting: meeting({ id: "mtg_now" }),
      person: alex,
      commitments: [
        commitment({
          id: "c_mine",
          counterpartId: "per_alex",
          direction: "mine",
          status: "active",
        }),
        commitment({
          id: "c_theirs",
          counterpartId: "per_alex",
          direction: "owed_to_me",
          status: "active",
        }),
        commitment({ id: "c_done", counterpartId: "per_alex", direction: "mine", status: "done" }),
        commitment({
          id: "c_other",
          counterpartId: "per_other",
          direction: "mine",
          status: "active",
        }),
      ],
      previous: null,
      previousNotes: [],
    });
    expect(prep.openMine.map((c) => c.id)).toEqual(["c_mine"]);
    expect(prep.openTheirs.map((c) => c.id)).toEqual(["c_theirs"]);
  });

  it("carries the previous standup's open action items, not done ones", () => {
    const previous = meeting({
      id: "mtg_prev",
      classification: "standup",
      personId: null,
      title: "Standup",
      actionItems: [
        { text: "Open item", ownerName: "Alex", done: false },
        { text: "Done item", ownerName: "Sam", done: true },
      ],
    });
    const prep = buildPrep({
      meeting: meeting({
        id: "mtg_now",
        classification: "standup",
        personId: null,
        title: "Standup",
      }),
      person: null,
      commitments: [],
      previous,
      previousNotes: [],
    });
    expect(prep.carriedActionItems).toEqual([
      { text: "Open item", ownerName: "Alex", done: false },
    ]);
  });

  it("takes the latest previous 1:1 note excerpt", () => {
    const previous = meeting({
      id: "mtg_prev",
      classification: "one_on_one",
      personId: "per_alex",
      title: "1:1",
    });
    const notes = [
      sourceItem({
        id: "note_old",
        text: "Older note content",
        occurredAt: "2026-10-20T10:00:00.000Z",
      }),
      sourceItem({
        id: "note_new",
        text: "Newer note content that is longer than the excerpt limit",
        occurredAt: "2026-10-22T10:00:00.000Z",
      }),
    ];
    const prep = buildPrep({
      meeting: meeting({ id: "mtg_now" }),
      person: alex,
      commitments: [],
      previous,
      previousNotes: notes,
    });
    expect(prep.lastNotes).toEqual({
      sourceItemId: "note_new",
      occurredAt: "2026-10-22T10:00:00.000Z",
      excerpt: "Newer note content that is longer than the excerpt limit".slice(0, 280),
    });
  });

  it("limits the excerpt to 280 characters", () => {
    const previous = meeting({
      id: "mtg_prev",
      classification: "one_on_one",
      personId: "per_alex",
      title: "1:1",
    });
    const text = "a".repeat(400);
    const prep = buildPrep({
      meeting: meeting({ id: "mtg_now" }),
      person: alex,
      commitments: [],
      previous,
      previousNotes: [
        sourceItem({ id: "note_long", text, occurredAt: "2026-10-22T10:00:00.000Z" }),
      ],
    });
    expect(prep.lastNotes?.excerpt).toHaveLength(280);
    expect(prep.lastNotes?.excerpt).toBe("a".repeat(280));
  });
});
