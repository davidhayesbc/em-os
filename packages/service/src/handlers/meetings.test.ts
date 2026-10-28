import type { ExternalMeeting } from "@emos/api-contract";
import { createClient, httpTransport } from "@emos/api-contract";
import { createMeetingsRepo, createPeopleRepo, dataLayout, openDb } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { authHeaders, cleanup, request, startTestService, tmpDir } from "../test-helpers.js";

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

    // Re-pasting the same note after reclassification must not lower its sensitivity.
    const noteAfter = await client.call("meetings.attachNotes", {
      meetingId: meeting.id,
      text: "Career discussion summary",
      kind: "summary",
    });
    expect(noteAfter.id).toBe(note.id);
    expect(noteAfter.sensitivity).toBe("people_sensitive");
    const got4 = await client.call("meetings.get", { id: meeting.id });
    expect(got4.notes).toHaveLength(1);
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

  it("does not lower sensitivity when a duplicate manual paste is replayed after reclassification", async () => {
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
    const meeting = list[0];
    if (!meeting) throw new Error("expected one meeting");
    const summary = {
      meetingId: meeting.id,
      text: "Sensitive summary content",
      kind: "summary" as const,
    };
    const transcript = {
      meetingId: meeting.id,
      text: "Sensitive transcript content",
      kind: "transcript" as const,
    };

    const initialSummary = await client.call("meetings.attachNotes", summary);
    const initialTranscript = await client.call("meetings.attachNotes", transcript);
    expect(initialSummary.sensitivity).toBe("people_sensitive");
    expect(initialTranscript.sensitivity).toBe("people_sensitive");

    await client.call("meetings.update", {
      id: summary.meetingId,
      patch: { classification: "team" },
    });

    const duplicateSummary = await client.call("meetings.attachNotes", summary);
    const duplicateTranscript = await client.call("meetings.attachNotes", transcript);
    expect(duplicateSummary.id).toBe(initialSummary.id);
    expect(duplicateSummary.sensitivity).toBe("people_sensitive");
    expect(duplicateTranscript.id).toBe(initialTranscript.id);
    expect(duplicateTranscript.sensitivity).toBe("people_sensitive");

    const got = await client.call("meetings.get", { id: summary.meetingId });
    expect(got.notes).toHaveLength(2);
    for (const n of got.notes) {
      expect(n.sensitivity).toBe("people_sensitive");
    }
  });

  it("private source labels are preserved and normal sources can be upgraded on duplicate paste", async () => {
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

    let alexId: string;
    const seedDb = openDb(dataLayout(dataDir).dbFile);
    try {
      const people = createPeopleRepo(seedDb, {
        now: () => new Date("2026-10-25T12:00:00.000Z"),
        id: (prefix) => `${prefix}_alex`,
      });
      alexId = people.create(personInput).id;
      createMeetingsRepo(seedDb).upsertExternal({
        ...oneOnOne(alexId),
        externalId: "upgrade-1on1",
      });
      createMeetingsRepo(seedDb).upsertExternal({
        ...standup,
        externalId: "normal-source",
        classification: "team",
        personId: null,
      });
    } finally {
      seedDb.close();
    }

    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const meetings = await client.call("meetings.list", {
      from: "2026-10-25T00:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
    });
    const oneOnOneMeeting = meetings.find((m) => m.classification === "one_on_one");
    const teamMeeting = meetings.find((m) => m.classification === "team");
    if (!oneOnOneMeeting || !teamMeeting) throw new Error("expected both meetings");

    const privateNote = await client.call("meetings.attachNotes", {
      meetingId: oneOnOneMeeting.id,
      text: "Private discussion",
      kind: "summary",
    });

    // Simulate an intentional private label (e.g. a future relabelling operation).
    {
      const liveDb = openDb(dataLayout(dataDir).dbFile);
      try {
        liveDb
          .prepare("UPDATE source_items SET sensitivity = 'private' WHERE id = ?")
          .run(privateNote.id);
      } finally {
        liveDb.close();
      }
    }

    const privateReplay = await client.call("meetings.attachNotes", {
      meetingId: oneOnOneMeeting.id,
      text: "Private discussion",
      kind: "summary",
    });
    expect(privateReplay.id).toBe(privateNote.id);
    expect(privateReplay.sensitivity).toBe("private");

    // A normal note re-pasted in a 1:1 upgrades to people_sensitive.
    const normalNote = await client.call("meetings.attachNotes", {
      meetingId: teamMeeting.id,
      text: "Team notes",
      kind: "summary",
    });
    expect(normalNote.sensitivity).toBe("normal");

    await client.call("meetings.update", {
      id: teamMeeting.id,
      patch: { classification: "one_on_one", personId: alexId },
    });
    const upgraded = await client.call("meetings.attachNotes", {
      meetingId: teamMeeting.id,
      text: "Team notes",
      kind: "summary",
    });
    expect(upgraded.id).toBe(normalNote.id);
    expect(upgraded.sensitivity).toBe("people_sensitive");
  });

  it("isolates duplicate detection by meeting", async () => {
    const dataDir = tmpDir();
    const m1 = seedMeeting(dataDir, {
      ...standup,
      externalId: "isolated-1",
      classification: "one_on_one",
      personId: null,
    });
    const m2 = seedMeeting(dataDir, {
      ...standup,
      externalId: "isolated-2",
      classification: "one_on_one",
      personId: null,
    });

    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const n1 = await client.call("meetings.attachNotes", {
      meetingId: m1,
      text: "Same text",
      kind: "summary",
    });
    const n2 = await client.call("meetings.attachNotes", {
      meetingId: m2,
      text: "Same text",
      kind: "summary",
    });
    expect(n1.id).not.toBe(n2.id);
    expect(n1.sensitivity).toBe("people_sensitive");
    expect(n2.sensitivity).toBe("people_sensitive");
  });

  it("persists sensitivity labels across service restart", async () => {
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
    const meeting = list[0];
    if (!meeting) throw new Error("expected one meeting");

    const note = await client.call("meetings.attachNotes", {
      meetingId: meeting.id,
      text: "Career discussion",
      kind: "summary",
    });
    expect(note.sensitivity).toBe("people_sensitive");

    await client.call("meetings.update", {
      id: meeting.id,
      patch: { classification: "team" },
    });

    await svc.stop();

    const svc2 = await startTestService({ dataDir });
    const client2 = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc2.port}`),
      token: svc2.token,
    });

    const duplicate = await client2.call("meetings.attachNotes", {
      meetingId: meeting.id,
      text: "Career discussion",
      kind: "summary",
    });
    expect(duplicate.id).toBe(note.id);
    expect(duplicate.sensitivity).toBe("people_sensitive");

    await svc2.stop();
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

  it("rejects forbidden and mixed patch fields over raw HTTP", async () => {
    const dataDir = tmpDir();
    const meetingId = seedMeeting(dataDir, {
      ...standup,
      externalId: "patch-strict",
      title: "Original title",
      classification: "team",
    });
    const svc = await startTestService({ dataDir });

    const forbidden = await request(svc.port, {
      path: "/rpc/meetings.update",
      headers: authHeaders(svc.token),
      body: JSON.stringify({
        id: meetingId,
        patch: { connectorId: "changed", classificationSource: "user" },
      }),
    });
    expect(forbidden.status).toBe(400);
    expect((forbidden.json as { ok: boolean; error?: { code: string } }).ok).toBe(false);

    const mixed = await request(svc.port, {
      path: "/rpc/meetings.update",
      headers: authHeaders(svc.token),
      body: JSON.stringify({
        id: meetingId,
        patch: { classification: "one_on_one", connectorId: "changed" },
      }),
    });
    expect(mixed.status).toBe(400);
    expect((mixed.json as { ok: boolean }).ok).toBe(false);

    await svc.stop();

    const svc2 = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc2.port}`),
      token: svc2.token,
    });
    const got = await client.call("meetings.get", { id: meetingId });
    expect(got.meeting.title).toBe("Original title");
    expect(got.meeting.classification).toBe("team");
    expect(got.meeting.classificationSource).toBe("auto");
    await svc2.stop();
  });

  it("rejects empty and unknown personId without persistence side effects", async () => {
    const dataDir = tmpDir();
    const seedDb = openDb(dataLayout(dataDir).dbFile);
    let alexId: string;
    let meetingId: string;
    try {
      const people = createPeopleRepo(seedDb, {
        now: () => new Date("2026-10-25T12:00:00.000Z"),
        id: (prefix) => `${prefix}_alex`,
      });
      alexId = people.create({
        displayName: "Alex Rivera",
        relationship: "peer",
        pronouns: null,
        aliases: [],
        role: "Engineer",
        timeZone: null,
        archived: false,
        oneOnOneCadenceDays: null,
      }).id;
      meetingId = createMeetingsRepo(seedDb).upsertExternal({
        ...oneOnOne(alexId),
        externalId: "empty-person",
      }).meeting.id;
    } finally {
      seedDb.close();
    }

    const svc = await startTestService({ dataDir });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const empty = await request(svc.port, {
      path: "/rpc/meetings.update",
      headers: authHeaders(svc.token),
      body: JSON.stringify({ id: meetingId, patch: { personId: "" } }),
    });
    expect(empty.status).toBe(404);
    expect((empty.json as { ok: boolean; error?: { code: string } }).error?.code).toBe("not_found");

    const unknown = await request(svc.port, {
      path: "/rpc/meetings.update",
      headers: authHeaders(svc.token),
      body: JSON.stringify({ id: meetingId, patch: { personId: "per_missing" } }),
    });
    expect(unknown.status).toBe(404);

    const got = await client.call("meetings.get", { id: meetingId });
    expect(got.meeting.personId).toBe(alexId);

    // Null clears the relationship.
    const cleared = await client.call("meetings.update", {
      id: meetingId,
      patch: { personId: null },
    });
    expect(cleared.personId).toBeNull();
    const got2 = await client.call("meetings.get", { id: meetingId });
    expect(got2.meeting.personId).toBeNull();
  });
});
