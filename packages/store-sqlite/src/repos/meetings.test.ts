import type { ExternalMeeting } from "@emos/api-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { createStore } from "../store.js";
import { createMeetingsRepo } from "./meetings.js";
import { createPeopleRepo } from "./people.js";
import { createSourceItemsRepo } from "./source-items.js";

const now = "2026-10-25T12:00:00.000Z";
let db: ReturnType<typeof openDb>;
let sequence = 0;

beforeEach(() => {
  db = openDb(":memory:");
  sequence = 0;
});
afterEach(() => db.close());

const repo = () =>
  createMeetingsRepo(db, {
    now: () => new Date(now),
    id: (prefix) => `${prefix}_${++sequence}`,
  });
const sourceRepo = () =>
  createSourceItemsRepo(db, {
    now: () => new Date(now),
    id: (prefix) => `${prefix}_${++sequence}`,
  });

function externalMeeting(overrides: Partial<ExternalMeeting> = {}): ExternalMeeting {
  const n = ++sequence;
  return {
    connectorId: "cal",
    externalId: `evt-${n}`,
    title: `Meeting ${n}`,
    start: `2026-10-25T${String(n).padStart(2, "0")}:00:00.000Z`,
    end: `2026-10-25T${String(n + 1).padStart(2, "0")}:00:00.000Z`,
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification: "other",
    classificationSource: "auto",
    personId: null,
    attendees: [],
    actionItems: [],
    url: null,
    ...overrides,
  };
}

describe("MeetingsRepo", () => {
  it("upserts external meetings idempotently", () => {
    const r = repo();
    const m = externalMeeting();
    const first = r.upsertExternal(m);
    const second = r.upsertExternal({ ...m, title: "Updated title" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.meeting.id).toBe(first.meeting.id);
    expect(second.meeting.title).toBe("Updated title");
    expect(second.meeting.capturedAt).toBe(first.meeting.capturedAt);
    expect(second.meeting.updatedAt).toBe(now);
  });

  it("preserves user classification and personId on re-sync", () => {
    const r = repo();
    const people = createPeopleRepo(db, {
      now: () => new Date(now),
      id: (prefix) => `${prefix}_${++sequence}`,
    });
    const alex = people.create({
      displayName: "Alex Rivera",
      relationship: "peer",
      pronouns: null,
      aliases: [],
      role: null,
      timeZone: null,
      archived: false,
      oneOnOneCadenceDays: null,
    });

    const m = externalMeeting({ classification: "other", personId: null });
    const first = r.upsertExternal(m);
    r.update(first.meeting.id, { classification: "one_on_one", personId: alex.id });

    const second = r.upsertExternal({ ...m, classification: "team", personId: null });
    expect(second.meeting.classification).toBe("one_on_one");
    expect(second.meeting.personId).toBe(alex.id);
    expect(second.meeting.classificationSource).toBe("user");
  });

  it("round-trips attendees and action items", () => {
    const r = repo();
    const m = externalMeeting({
      attendees: [
        {
          identityId: null,
          personId: null,
          displayName: "Alex Rivera",
          email: "alex@example.com",
        },
      ],
      actionItems: [{ text: "Follow up", ownerName: "Alex Rivera", done: false }],
    });
    const created = r.upsertExternal(m).meeting;

    expect(r.get(created.id)).toEqual(created);
  });

  it("lists meetings in a range and excludes cancelled by default", () => {
    const r = repo();
    const a = r.upsertExternal(
      externalMeeting({
        externalId: "a",
        start: "2026-10-25T09:00:00.000Z",
        end: "2026-10-25T10:00:00.000Z",
      }),
    ).meeting;
    const b = r.upsertExternal(
      externalMeeting({
        externalId: "b",
        start: "2026-10-25T10:00:00.000Z",
        end: "2026-10-25T11:00:00.000Z",
        status: "cancelled",
      }),
    ).meeting;
    const c = r.upsertExternal(
      externalMeeting({
        externalId: "c",
        start: "2026-10-25T11:00:00.000Z",
        end: "2026-10-25T12:00:00.000Z",
      }),
    ).meeting;

    const list = r.listRange("2026-10-25T08:00:00.000Z", "2026-10-25T13:00:00.000Z");
    expect(list.map((m) => m.id)).toEqual([a.id, c.id]);

    const include = r.listRange("2026-10-25T08:00:00.000Z", "2026-10-25T13:00:00.000Z", {
      includeCancelled: true,
    });
    expect(include.map((m) => m.id)).toEqual([a.id, b.id, c.id]);
  });

  it("filters by personId and classification", () => {
    const r = repo();
    const people = createPeopleRepo(db, {
      now: () => new Date(now),
      id: (prefix) => `${prefix}_${++sequence}`,
    });
    const alex = people.create({
      displayName: "Alex Rivera",
      relationship: "peer",
      pronouns: null,
      aliases: [],
      role: null,
      timeZone: null,
      archived: false,
      oneOnOneCadenceDays: null,
    });
    const sam = people.create({
      displayName: "Sam Chen",
      relationship: "peer",
      pronouns: null,
      aliases: [],
      role: null,
      timeZone: null,
      archived: false,
      oneOnOneCadenceDays: null,
    });

    const a = r.upsertExternal(
      externalMeeting({ externalId: "a", personId: alex.id, classification: "one_on_one" }),
    ).meeting;
    r.upsertExternal(
      externalMeeting({ externalId: "b", personId: sam.id, classification: "team" }),
    );

    expect(
      r
        .listRange("2026-10-25T00:00:00.000Z", "2026-10-26T00:00:00.000Z", { personId: alex.id })
        .map((m) => m.id),
    ).toEqual([a.id]);
    expect(
      r
        .listRange("2026-10-25T00:00:00.000Z", "2026-10-26T00:00:00.000Z", {
          classification: "one_on_one",
        })
        .map((m) => m.id),
    ).toEqual([a.id]);
  });

  it("returns the previous meeting matching filters", () => {
    const r = repo();
    const standup1 = r.upsertExternal(
      externalMeeting({
        externalId: "s1",
        start: "2026-10-25T09:00:00.000Z",
        end: "2026-10-25T09:30:00.000Z",
        classification: "standup",
      }),
    ).meeting;
    const standup2 = r.upsertExternal(
      externalMeeting({
        externalId: "s2",
        start: "2026-10-26T09:00:00.000Z",
        end: "2026-10-26T09:30:00.000Z",
        classification: "standup",
      }),
    ).meeting;
    const oneOnOne = r.upsertExternal(
      externalMeeting({
        externalId: "oo",
        start: "2026-10-25T10:00:00.000Z",
        end: "2026-10-25T10:30:00.000Z",
        classification: "one_on_one",
      }),
    ).meeting;

    expect(r.previousOf(standup2, { classification: "standup" })?.id).toBe(standup1.id);
    expect(r.previousOf(standup2)?.id).toBe(oneOnOne.id);
    expect(r.previousOf(oneOnOne, { classification: "standup" })?.id).toBe(standup1.id);
  });

  it("attaches notes idempotently", () => {
    const r = repo();
    const s = sourceRepo();
    const m = r.upsertExternal(externalMeeting()).meeting;
    const note = s.upsert({
      connectorId: "manual",
      externalId: "manual:note",
      kind: "note",
      origin: "manual",
      url: null,
      authorIdentityId: null,
      text: "Note text",
      contentHash: "hash",
      sensitivity: "normal",
      sections: null,
      occurredAt: m.start,
    }).item;

    r.attachNote(m.id, note.id);
    r.attachNote(m.id, note.id);

    expect(r.notes(m.id).map((n) => n.id)).toEqual([note.id]);
  });

  it("throws not_found for an unknown id on update", () => {
    expect(() => repo().update("mtg_missing", { classification: "team" })).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
  });

  it("normalizes seconds-only and fractional instants on upsert and list", () => {
    const r = repo();
    const m = r.upsertExternal(
      externalMeeting({
        externalId: "seconds",
        start: "2026-10-25T09:00:00Z",
        end: "2026-10-25T10:00:00.123456Z",
      }),
    ).meeting;
    expect(m.start).toBe("2026-10-25T09:00:00.000Z");
    expect(m.end).toBe("2026-10-25T10:00:00.123Z");

    const list = r.listRange("2026-10-25T09:00:00Z", "2026-10-25T10:00:00Z");
    expect(list.map((x) => x.id)).toEqual([m.id]);
  });

  it("listRange is inclusive-from and exclusive-to", () => {
    const r = repo();
    const a = r.upsertExternal(
      externalMeeting({
        externalId: "a",
        start: "2026-10-25T09:00:00.000Z",
        end: "2026-10-25T10:00:00.000Z",
      }),
    ).meeting;
    const b = r.upsertExternal(
      externalMeeting({
        externalId: "b",
        start: "2026-10-25T10:00:00.000Z",
        end: "2026-10-25T11:00:00.000Z",
      }),
    ).meeting;

    expect(
      r.listRange("2026-10-25T09:00:00.000Z", "2026-10-25T10:00:00.000Z").map((m) => m.id),
    ).toEqual([a.id]);
    expect(
      r.listRange("2026-10-25T09:00:00.000Z", "2026-10-25T11:00:00.000Z").map((m) => m.id),
    ).toEqual([a.id, b.id]);
  });

  it("previousOf normalizes seconds-only instant", () => {
    const r = repo();
    const a = r.upsertExternal(
      externalMeeting({
        externalId: "a",
        start: "2026-10-25T09:00:00.000Z",
        end: "2026-10-25T10:00:00.000Z",
      }),
    ).meeting;
    const b = r.upsertExternal(
      externalMeeting({
        externalId: "b",
        start: "2026-10-25T10:00:00.000Z",
        end: "2026-10-25T11:00:00.000Z",
      }),
    ).meeting;

    const previous = r.previousOf({ ...b, start: "2026-10-25T10:00:00Z" });
    expect(previous?.id).toBe(a.id);
  });

  it("atomic upsert rolls back meeting and attendees on attendee FK failure", () => {
    const r = repo();
    const bad = {
      identityId: null,
      personId: "per_missing",
      displayName: "Alex Rivera",
      email: null,
    } as const;

    expect(() =>
      r.upsertExternal(externalMeeting({ externalId: "partial-create", attendees: [bad] })),
    ).toThrowError(expect.objectContaining({ code: "ERR_SQLITE_ERROR" }));
    expect(
      db.prepare("SELECT id FROM meetings WHERE external_id = ?").get("partial-create"),
    ).toBeUndefined();

    const before = r.upsertExternal(
      externalMeeting({ externalId: "partial-update", attendees: [{ ...bad, personId: null }] }),
    ).meeting;
    expect(() =>
      r.upsertExternal(
        externalMeeting({ externalId: "partial-update", title: "Changed", attendees: [bad] }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ERR_SQLITE_ERROR" }));

    const after = r.get(before.id);
    expect(after?.title).toBe(before.title);
    expect(after?.attendees).toEqual(before.attendees);
  });

  it("atomic upsert rolls back inside an outer Store transaction", () => {
    const store = createStore(db);
    const bad = {
      identityId: null,
      personId: "per_missing",
      displayName: "Alex Rivera",
      email: null,
    } as const;

    expect(() =>
      store.transaction(() => {
        store.meetings.upsertExternal(externalMeeting({ externalId: "outer", attendees: [bad] }));
      }),
    ).toThrowError(expect.objectContaining({ code: "ERR_SQLITE_ERROR" }));

    expect(
      db.prepare("SELECT id FROM meetings WHERE external_id = ?").get("outer"),
    ).toBeUndefined();
  });
});
