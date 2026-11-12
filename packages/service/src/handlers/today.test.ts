import type { ExternalMeeting, NewCommitment, NewPerson } from "@emos/api-contract";
import { createClient, httpTransport } from "@emos/api-contract";
import {
  createCommitmentsRepo,
  createMeetingsRepo,
  createPeopleRepo,
  dataLayout,
  openDb,
} from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, startTestService, tmpDir } from "../test-helpers.js";

afterEach(cleanup);

const at = "2026-10-25T12:00:00.000Z";
const localDate = "2026-10-25";

function personInput(displayName: string): NewPerson {
  return {
    displayName,
    relationship: displayName === "Self" ? "self" : "peer",
    pronouns: null,
    aliases: [],
    role: "Engineer",
    timeZone: null,
    archived: false,
    oneOnOneCadenceDays: null,
  };
}

function externalMeeting(start: string, end: string): ExternalMeeting {
  return {
    connectorId: "cal",
    externalId: `ext_${start}`,
    title: "Standup",
    start,
    end,
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

describe("today API", () => {
  it("returns empty state when store is empty", async () => {
    const svc = await startTestService();
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });

    const result = await client.call("today.get", { localDate });
    expect(result.onboarded).toBe(false);
    expect(result.top).toEqual([]);
    expect(result.timeline.meetings).toEqual([]);
    expect(result.waitingOn).toEqual([]);
    expect(result.progress).toEqual({ done: 0, total: 0 });
    expect(result.header.toTriage).toBe(0);
  });

  it("keeps the day plan stable and refreshes on demand", async () => {
    const dataDir = tmpDir();
    const seedDb = openDb(dataLayout(dataDir).dbFile);
    let selfId: string;
    let seedCount = 0;
    try {
      const people = createPeopleRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_self_${++seedCount}`,
      });
      selfId = people.create(personInput("Self")).id;

      const meetings = createMeetingsRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_mtg_${++seedCount}`,
      });
      meetings.upsertExternal(
        externalMeeting("2026-10-25T09:00:00.000Z", "2026-10-25T09:30:00.000Z"),
      );

      const commitments = createCommitmentsRepo(seedDb, {
        now: () => new Date(at),
        id: (prefix) => `${prefix}_cmt_${++seedCount}`,
      });
      commitments.create(
        commitmentInput({
          title: "one",
          ownerId: selfId,
          due: { date: localDate, time: null, timeZone: "UTC" },
        }),
      );
      commitments.create(
        commitmentInput({
          title: "two",
          ownerId: selfId,
          due: { date: localDate, time: null, timeZone: "UTC" },
        }),
      );
      commitments.create(
        commitmentInput({
          title: "three",
          ownerId: selfId,
          due: { date: localDate, time: null, timeZone: "UTC" },
        }),
      );
      commitments.create(
        commitmentInput({
          title: "four",
          ownerId: selfId,
          due: { date: localDate, time: null, timeZone: "UTC" },
        }),
      );
      commitments.create(
        commitmentInput({
          title: "five",
          ownerId: selfId,
          due: { date: localDate, time: null, timeZone: "UTC" },
        }),
      );
      commitments.create(
        commitmentInput({
          title: "six",
          ownerId: selfId,
          due: { date: "2026-10-26", time: null, timeZone: "UTC" },
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

    const first = await client.call("today.get", { localDate });
    const firstIds = first.top.map((t: { commitment: { id: string } }) => t.commitment.id);
    expect(firstIds).toHaveLength(5);
    expect(first.timeline.meetings).toHaveLength(1);

    // Mark the second item as done.
    const item2Id = firstIds[1];
    if (!item2Id) throw new Error("Expected a second top item");
    await client.call("commitments.complete", { id: item2Id });

    // Add a new high-priority due-today item.
    await client.call("commitments.create", {
      ...commitmentInput({ title: "seven", ownerId: selfId, priority: 0 }),
      due: { date: localDate, time: null, timeZone: "UTC" },
    });

    const second = await client.call("today.get", { localDate });
    const secondIds = second.top.map((t: { commitment: { id: string } }) => t.commitment.id);
    expect(secondIds).toEqual(firstIds);
    const item2 = second.top.find(
      (t: { commitment: { id: string } }) => t.commitment.id === firstIds[1],
    );
    expect(item2?.done).toBe(true);
    expect(item2?.item).toBeNull();
    expect(second.progress).toEqual({ done: 1, total: 5 });

    const refreshed = await client.call("today.refresh", { localDate });
    const refreshedIds = refreshed.top.map((t: { commitment: { id: string } }) => t.commitment.id);
    expect(refreshedIds).not.toEqual(firstIds);
  });
});
