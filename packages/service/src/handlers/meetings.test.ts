import type { ExternalMeeting } from "@emos/api-contract";
import { createClient, httpTransport } from "@emos/api-contract";
import { createMeetingsRepo, createPeopleRepo, dataLayout, openDb } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, startTestService, tmpDir } from "../test-helpers.js";

afterEach(cleanup);

function seedMeeting(dataDir: string, m: ExternalMeeting): string {
  const db = openDb(dataLayout(dataDir).dbFile);
  try {
    const repo = createMeetingsRepo(db);
    return repo.upsertExternal(m).meeting.id;
  } finally {
    db.close();
  }
}

const standup: ExternalMeeting = {
  connectorId: "cal",
  externalId: "standup-1",
  title: "Team standup",
  start: "2026-10-25T09:00:00.000Z",
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

const oneOnOne = (personId: string): ExternalMeeting => ({
  ...standup,
  externalId: "1on1-1",
  title: "1:1 with Alex",
  start: "2026-10-25T10:00:00.000Z",
  end: "2026-10-25T10:30:00.000Z",
  classification: "one_on_one",
  personId,
});

describe("meetings API", () => {
  it("lists, gets and updates meetings with pasted notes", async () => {
    const dataDir = tmpDir();
    const personInput = {
      displayName: "Alex Rivera",
      relationship: "peer" as const,
      pronouns: null,
      aliases: [],
      role: "Engineer",
      timeZone: null,
      archived: false,
      oneOnOneCadenceDays: null,
    };

    // Seed the person and meeting directly through repos so the service tests the API surface.
    let alexId: string;
    const seedDb = openDb(dataLayout(dataDir).dbFile);
    try {
      const people = createPeopleRepo(seedDb, {
        now: () => new Date("2026-10-25T12:00:00.000Z"),
        id: (prefix) => `${prefix}_alex`,
      });
      alexId = people.create(personInput).id;
      createMeetingsRepo(seedDb).upsertExternal(oneOnOne(alexId));
    } finally {
      seedDb.close();
    }

    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const list = await client.call("meetings.list", {
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
    });
    expect(list).toHaveLength(1);
    const meeting = list[0];
    if (!meeting) throw new Error("expected one meeting");
    expect(meeting.classification).toBe("one_on_one");
    expect(meeting.personId).toBe(alexId);

    const got = await client.call("meetings.get", { id: meeting.id });
    expect(got.meeting.id).toBe(meeting.id);
    expect(got.notes).toEqual([]);

    const note = await client.call("meetings.attachNotes", {
      meetingId: meeting.id,
      text: "Career discussion summary",
      kind: "summary",
    });
    expect(note.kind).toBe("note");
    expect(note.origin).toBe("manual");
    expect(note.sensitivity).toBe("people_sensitive");
    expect(note.occurredAt).toBe(meeting.start);

    const got2 = await client.call("meetings.get", { id: meeting.id });
    expect(got2.notes.map((n) => n.id)).toEqual([note.id]);

    // Duplicate attachment is idempotent.
    const note2 = await client.call("meetings.attachNotes", {
      meetingId: meeting.id,
      text: "Career discussion summary",
      kind: "summary",
    });
    expect(note2.id).toBe(note.id);
    const got3 = await client.call("meetings.get", { id: meeting.id });
    expect(got3.notes).toHaveLength(1);

    // User classification change sets source=user.
    const updated = await client.call("meetings.update", {
      id: meeting.id,
      patch: { classification: "team" },
    });
    expect(updated.classification).toBe("team");
    expect(updated.classificationSource).toBe("user");
  });

  it("transcript notes are normal sensitivity for non-1:1s", async () => {
    const dataDir = tmpDir();
    const meetingId = seedMeeting(dataDir, standup);
    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const note = await client.call("meetings.attachNotes", {
      meetingId,
      text: "Standup transcript",
      kind: "transcript",
    });
    expect(note.kind).toBe("transcript");
    expect(note.sensitivity).toBe("normal");
  });

  it("rejects missing meetings and invalid kinds", async () => {
    const svc = await startTestService();
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    await expect(client.call("meetings.get", { id: "mtg_missing" })).rejects.toMatchObject({
      code: "not_found",
    });

    await expect(
      client.call("meetings.attachNotes", {
        meetingId: "mtg_missing",
        text: "x",
        kind: "summary",
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
      client.call("meetings.update", {
        id: "mtg_missing",
        patch: { classification: "team" },
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
      client.call("meetings.attachNotes", {
        meetingId: "mtg_1",
        text: "x",
        // @ts-expect-error invalid kind
        kind: "invalid",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("persists notes after reopening the database", async () => {
    const dataDir = tmpDir();
    const meetingId = seedMeeting(dataDir, {
      ...standup,
      externalId: "persist-1",
      title: "Design review",
      start: "2026-10-25T14:00:00.000Z",
      end: "2026-10-25T15:00:00.000Z",
      classification: "team",
    });

    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const note = await client.call("meetings.attachNotes", {
      meetingId,
      text: "Decisions: keep the API",
      kind: "summary",
    });

    await svc.stop();

    // Restart service on the same data dir.
    const svc2 = await startTestService({ dataDir });
    const client2 = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc2.port}`),
      token: svc2.token,
    });

    const got = await client2.call("meetings.get", { id: meetingId });
    expect(got.notes.map((n) => ({ id: n.id, text: n.text, kind: n.kind }))).toEqual([
      { id: note.id, text: "Decisions: keep the API", kind: "note" },
    ]);

    await svc2.stop();
  });
});
