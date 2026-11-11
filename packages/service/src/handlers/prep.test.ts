import type { ExternalMeeting, NewCommitment, NewPerson } from "@emos/api-contract";
import { createClient, httpTransport } from "@emos/api-contract";
import {
  createCommitmentsRepo,
  createMeetingsRepo,
  createPeopleRepo,
  createSourceItemsRepo,
  dataLayout,
  openDb,
} from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, startTestService, tmpDir } from "../test-helpers.js";

afterEach(cleanup);

const at = "2026-10-25T12:00:00.000Z";

function personInput(displayName: string): NewPerson {
  return {
    displayName,
    relationship: "peer",
    pronouns: null,
    aliases: [],
    role: "Engineer",
    timeZone: null,
    archived: false,
    oneOnOneCadenceDays: null,
  };
}

function oneOnOneMeeting(personId: string): ExternalMeeting {
  return {
    connectorId: "cal",
    externalId: "1on1-1",
    title: "1:1 with Alex",
    start: "2026-10-25T10:00:00.000Z",
    end: "2026-10-25T10:30:00.000Z",
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification: "one_on_one",
    classificationSource: "auto",
    personId,
    attendees: [],
    actionItems: [],
    url: null,
  };
}

function standupMeeting(start: string, externalId: string): ExternalMeeting {
  return {
    connectorId: "cal",
    externalId,
    title: "Team standup",
    start,
    end: "2026-10-25T09:30:00.000Z",
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification: "standup",
    classificationSource: "auto",
    personId: null,
    attendees: [],
    actionItems: [],
    url: null,
  };
}

function commitmentInput(overrides: Partial<NewCommitment> & { title: string }): NewCommitment {
  const { title, ...rest } = overrides;
  return {
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
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    confidence: null,
    ...rest,
  };
}

describe("prep API", () => {
  it("returns not_found for an unknown meeting", async () => {
    const svc = await startTestService();
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    await expect(client.call("prep.get", { meetingId: "mtg_missing" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("returns prep for a 1:1 with linked commitments and previous notes", async () => {
    const dataDir = tmpDir();
    const seedDb = openDb(dataLayout(dataDir).dbFile);
    let alexId: string;
    let selfId: string;
    let currentId: string;
    let previousId: string;
    let seedCount = 0;
    let personCount = 0;
    try {
      const people = createPeopleRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_alex_${++personCount}`,
      });
      alexId = people.create(personInput("Alex Rivera")).id;
      selfId = people.create({ ...personInput("Self"), relationship: "self" }).id;
      const meetings = createMeetingsRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_seed_${++seedCount}`,
      });
      previousId = meetings.upsertExternal(oneOnOneMeeting(alexId)).meeting.id;
      currentId = meetings.upsertExternal({
        ...oneOnOneMeeting(alexId),
        externalId: "1on1-2",
        start: "2026-10-26T10:00:00.000Z",
        end: "2026-10-26T10:30:00.000Z",
      }).meeting.id;

      const notes = createSourceItemsRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_note`,
      });
      const note = notes.upsert({
        connectorId: "manual",
        externalId: "note-prev",
        kind: "note",
        origin: "manual",
        url: null,
        authorIdentityId: null,
        text: "Previous 1:1 note content",
        contentHash: "hash",
        sensitivity: "people_sensitive",
        sections: null,
      }).item;
      meetings.attachNote(previousId, note.id);

      const commitments = createCommitmentsRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_commitment`,
      });
      commitments.create(
        commitmentInput({
          title: "Alex follow-up",
          direction: "mine",
          status: "active",
          counterpartId: alexId,
          meetingId: currentId,
          ownerId: selfId,
        }),
      );
    } finally {
      seedDb.close();
    }

    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const prep = await client.call("prep.get", { meetingId: currentId });
    expect(prep.meetingId).toBe(currentId);
    expect(prep.classification).toBe("one_on_one");
    expect(prep.status).toBe("needs_work");
    expect(prep.person?.id).toBe(alexId);
    expect(prep.openMine.map((c: { id: string }) => c.id)).toHaveLength(1);
    expect(prep.linked.map((c: { id: string }) => c.id)).toHaveLength(1);
    expect(prep.lastNotes).toEqual({
      sourceItemId: expect.stringContaining("_note"),
      occurredAt: expect.any(String),
      excerpt: "Previous 1:1 note content",
    });
  });

  it("carries previous standup action items", async () => {
    const dataDir = tmpDir();
    const seedDb = openDb(dataLayout(dataDir).dbFile);
    let currentId: string;
    let seedCount = 0;
    try {
      const meetings = createMeetingsRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_seed_${++seedCount}`,
      });
      const previousId = meetings.upsertExternal(
        standupMeeting("2026-10-24T09:00:00.000Z", "standup-prev"),
      ).meeting.id;
      meetings.update(previousId, {
        actionItems: [
          { text: "Open item", ownerName: "Alex", done: false },
          { text: "Done item", ownerName: "Sam", done: true },
        ],
      });
      currentId = meetings.upsertExternal(
        standupMeeting("2026-10-25T09:00:00.000Z", "standup-current"),
      ).meeting.id;
    } finally {
      seedDb.close();
    }

    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const prep = await client.call("prep.get", { meetingId: currentId });
    expect(prep.carriedActionItems).toEqual([
      { text: "Open item", ownerName: "Alex", done: false },
    ]);
    expect(prep.status).toBe("nothing_linked");
  });
});
