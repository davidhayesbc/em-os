import type { NewIdentity, NewPerson, NewPersonNote } from "@emos/api-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { createPeopleRepo } from "./people.js";

const now = "2026-10-25T12:00:00.000Z";
let db: ReturnType<typeof openDb>;
let sequence = 0;

const newPerson = (
  displayName: string,
  relationship: NewPerson["relationship"] = "other",
): NewPerson => ({
  displayName,
  relationship,
  pronouns: null,
  aliases: [],
  role: null,
  timeZone: null,
  archived: false,
  oneOnOneCadenceDays: null,
});
const newIdentity = (personId: string, handle: string): NewIdentity => ({
  personId,
  source: "chat",
  handle,
  confirmed: true,
});
const newNote = (personId: string, occurredAt: string, text: string): NewPersonNote => ({
  personId,
  text,
  tags: [],
  sourceUrl: null,
  sensitivity: "people_sensitive",
  origin: "manual",
  reviewState: "accepted",
  occurredAt,
});

beforeEach(() => {
  db = openDb(":memory:");
  sequence = 0;
});
afterEach(() => db.close());

const repo = () =>
  createPeopleRepo(db, {
    now: () => new Date(now),
    id: (prefix) => `${prefix}_${++sequence}`,
  });

describe("PeopleRepo", () => {
  it("creates, updates, gets and filters people", () => {
    const r = repo();
    const alex = r.create(newPerson("Alex Rivera", "peer"));
    r.create(newPerson("Jordan Patel", "manager"));

    expect(r.update(alex.id, { role: "Staff engineer" })).toMatchObject({
      id: alex.id,
      role: "Staff engineer",
      updatedAt: now,
    });
    expect(r.get(alex.id)?.displayName).toBe("Alex Rivera");
    expect(r.list({ relationship: ["peer"] }).map((p) => p.id)).toEqual([alex.id]);
  });

  it("rejects relationship filters larger than the relationship enum", () => {
    const relationships = Array.from({ length: 40_000 }, () => "peer" as const);
    expect(() => repo().list({ relationship: relationships })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });

  it("finds identity handles case-insensitively", () => {
    const r = repo();
    const alex = r.create(newPerson("Alex Rivera"));
    const added = r.addIdentity(newIdentity(alex.id, "@alex"));

    expect(r.findIdentity("chat", "@ALEX")).toEqual(added);
    expect(r.identities(alex.id)).toEqual([added]);
  });

  it("reports duplicate identities and a second self person as conflicts", () => {
    const r = repo();
    const alex = r.create(newPerson("Alex Rivera", "self"));
    const sam = r.create(newPerson("Sam Chen"));
    r.addIdentity(newIdentity(alex.id, "@alex"));

    expect(() => r.addIdentity(newIdentity(alex.id, "@ALEX"))).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
    expect(() => r.create(newPerson("Sam Chen", "self"))).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
    expect(() => r.update(sam.id, { relationship: "self" })).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("sorts notes chronologically", () => {
    const r = repo();
    const alex = r.create(newPerson("Alex Rivera"));
    const today = r.addNote(newNote(alex.id, now, "Current note"));
    const old = r.addNote(newNote(alex.id, "2026-09-01T07:00:00.000Z", "Backdated note"));

    expect(r.notes(alex.id).map((note) => note.id)).toEqual([old.id, today.id]);
    expect(r.notes(alex.id, { from: "2026-10-01T00:00:00.000Z" })).toEqual([today]);
  });
});
