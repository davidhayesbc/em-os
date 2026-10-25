import { randomUUID } from "node:crypto";
import {
  ApiError,
  type Identity,
  type NewIdentity,
  type NewPerson,
  type NewPersonNote,
  type Person,
  type PersonNote,
} from "@emos/api-contract";
import type { PeopleRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

type Row = Record<string, unknown>;
interface Deps {
  now(): Date;
  id(prefix: string): string;
}
const defaults: Deps = { now: () => new Date(), id: (prefix) => `${prefix}_${randomUUID()}` };
const json = <T>(value: unknown): T => JSON.parse(value as string) as T;
const bool = (value: unknown): boolean => value === 1;

function mapPerson(row: Row): Person {
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    relationship: row.relationship as Person["relationship"],
    pronouns: row.pronouns as string | null,
    aliases: json<string[]>(row.aliases),
    role: row.role as string | null,
    timeZone: row.time_zone as string | null,
    archived: bool(row.archived),
    oneOnOneCadenceDays: row.one_on_one_cadence_days as number | null,
    occurredAt: row.occurred_at as string,
    capturedAt: row.captured_at as string,
    updatedAt: row.updated_at as string,
    retentionState: row.retention_state as Person["retentionState"],
  };
}
function mapIdentity(row: Row): Identity {
  return {
    id: row.id as string,
    personId: row.person_id as string,
    source: row.source as Identity["source"],
    handle: row.handle as string,
    confirmed: bool(row.confirmed),
    occurredAt: row.occurred_at as string,
    capturedAt: row.captured_at as string,
    updatedAt: row.updated_at as string,
    retentionState: row.retention_state as Identity["retentionState"],
  };
}
function mapNote(row: Row): PersonNote {
  return {
    id: row.id as string,
    personId: row.person_id as string,
    text: row.text as string,
    tags: json<string[]>(row.tags),
    sourceUrl: row.source_url as string | null,
    sensitivity: row.sensitivity as PersonNote["sensitivity"],
    origin: row.origin as PersonNote["origin"],
    reviewState: row.review_state as PersonNote["reviewState"],
    occurredAt: row.occurred_at as string,
    capturedAt: row.captured_at as string,
    updatedAt: row.updated_at as string,
    retentionState: row.retention_state as PersonNote["retentionState"],
  };
}

export function createPeopleRepo(db: Db, deps: Partial<Deps> = {}): PeopleRepo {
  const d = { ...defaults, ...deps };
  return {
    create(input: NewPerson) {
      const at = toDbInstant(d.now());
      const person: Person = {
        ...input,
        id: d.id("per"),
        occurredAt: input.occurredAt ?? at,
        capturedAt: at,
        updatedAt: at,
        retentionState: input.retentionState ?? "active",
      };
      db.prepare(`INSERT INTO people
        (id,display_name,relationship,pronouns,aliases,role,time_zone,archived,one_on_one_cadence_days,occurred_at,captured_at,updated_at,retention_state)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        person.id,
        person.displayName,
        person.relationship,
        person.pronouns,
        JSON.stringify(person.aliases),
        person.role,
        person.timeZone,
        Number(person.archived),
        person.oneOnOneCadenceDays,
        person.occurredAt,
        person.capturedAt,
        person.updatedAt,
        person.retentionState,
      );
      return person;
    },
    update(id, patch) {
      const current = this.get(id);
      if (!current) throw new ApiError("not_found", "Person not found");
      const person: Person = { ...current, ...patch, id, updatedAt: toDbInstant(d.now()) };
      db.prepare(`UPDATE people SET
        display_name=?,relationship=?,pronouns=?,aliases=?,role=?,time_zone=?,archived=?,one_on_one_cadence_days=?,occurred_at=?,updated_at=?,retention_state=? WHERE id=?`).run(
        person.displayName,
        person.relationship,
        person.pronouns,
        JSON.stringify(person.aliases),
        person.role,
        person.timeZone,
        Number(person.archived),
        person.oneOnOneCadenceDays,
        person.occurredAt,
        person.updatedAt,
        person.retentionState,
        id,
      );
      return person;
    },
    get(id) {
      const row = db.prepare("SELECT * FROM people WHERE id=?").get<Row>(id);
      return row ? mapPerson(row) : null;
    },
    list(filter = {}) {
      const where: string[] = [];
      const values: unknown[] = [];
      if (!filter.includeArchived) where.push("archived=0");
      if (filter.relationship?.length) {
        where.push(`relationship IN (${filter.relationship.map(() => "?").join(",")})`);
        values.push(...filter.relationship);
      }
      return db
        .prepare(
          `SELECT * FROM people${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY display_name,id`,
        )
        .all<Row>(...values)
        .map(mapPerson);
    },
    addIdentity(input: NewIdentity) {
      const at = toDbInstant(d.now());
      const identity: Identity = {
        ...input,
        id: d.id("idn"),
        occurredAt: input.occurredAt ?? at,
        capturedAt: at,
        updatedAt: at,
        retentionState: input.retentionState ?? "active",
      };
      db.prepare(`INSERT INTO identities
        (id,person_id,source,handle,confirmed,occurred_at,captured_at,updated_at,retention_state)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        identity.id,
        identity.personId,
        identity.source,
        identity.handle,
        Number(identity.confirmed),
        identity.occurredAt,
        identity.capturedAt,
        identity.updatedAt,
        identity.retentionState,
      );
      return identity;
    },
    identities(personId) {
      return db
        .prepare("SELECT * FROM identities WHERE person_id=? ORDER BY captured_at,id")
        .all<Row>(personId)
        .map(mapIdentity);
    },
    findIdentity(source, handle) {
      const row = db
        .prepare("SELECT * FROM identities WHERE source=? AND handle=? COLLATE NOCASE")
        .get<Row>(source, handle);
      return row ? mapIdentity(row) : null;
    },
    addNote(input: NewPersonNote) {
      const at = toDbInstant(d.now());
      const note: PersonNote = {
        ...input,
        id: d.id("pno"),
        occurredAt: input.occurredAt ?? at,
        capturedAt: at,
        updatedAt: at,
        retentionState: input.retentionState ?? "active",
      };
      db.prepare(`INSERT INTO person_notes
        (id,person_id,text,tags,source_url,sensitivity,origin,review_state,occurred_at,captured_at,updated_at,retention_state)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        note.id,
        note.personId,
        note.text,
        JSON.stringify(note.tags),
        note.sourceUrl,
        note.sensitivity,
        note.origin,
        note.reviewState,
        note.occurredAt,
        note.capturedAt,
        note.updatedAt,
        note.retentionState,
      );
      return note;
    },
    notes(personId, range = {}) {
      const where = ["person_id=?"];
      const values: unknown[] = [personId];
      if (range.from) {
        where.push("occurred_at>=?");
        values.push(range.from);
      }
      if (range.to) {
        where.push("occurred_at<=?");
        values.push(range.to);
      }
      return db
        .prepare(`SELECT * FROM person_notes WHERE ${where.join(" AND ")} ORDER BY occurred_at,id`)
        .all<Row>(...values)
        .map(mapNote);
    },
  };
}
