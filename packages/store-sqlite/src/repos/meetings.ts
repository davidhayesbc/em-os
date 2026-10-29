import { randomUUID } from "node:crypto";
import { ApiError, type ExternalMeeting, type Meeting, type SourceItem } from "@emos/api-contract";
import type { MeetingsRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

interface Deps {
  now(): Date;
  id(prefix: string): string;
}
const defaults: Deps = { now: () => new Date(), id: (prefix) => `${prefix}_${randomUUID()}` };

type Row = Record<string, unknown>;
const str = (r: Row, key: string) => r[key] as string;
const nullable = (r: Row, key: string) => (r[key] === null ? null : (r[key] as string));
const parse = <T>(value: string | null): T | null =>
  value === null ? null : (JSON.parse(value) as T);

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    (error as { errcode?: unknown }).errcode === 2067
  );
}

function mapMeeting(row: Row, attendees: Meeting["attendees"]): Meeting {
  return {
    id: str(row, "id"),
    connectorId: str(row, "connector_id"),
    externalId: str(row, "external_id"),
    title: str(row, "title"),
    start: str(row, "start_at"),
    end: str(row, "end_at"),
    allDay: Number(row.all_day) === 1,
    status: str(row, "status") as Meeting["status"],
    selfResponse: nullable(row, "self_response") as Meeting["selfResponse"],
    classification: str(row, "classification") as Meeting["classification"],
    classificationSource: str(row, "classification_source") as Meeting["classificationSource"],
    personId: nullable(row, "person_id"),
    attendees,
    actionItems: parse<Meeting["actionItems"]>(str(row, "action_items")) ?? [],
    url: nullable(row, "url"),
    occurredAt: str(row, "occurred_at"),
    capturedAt: str(row, "captured_at"),
    updatedAt: str(row, "updated_at"),
    retentionState: str(row, "retention_state") as Meeting["retentionState"],
  };
}

function mapAttendee(row: Row): Meeting["attendees"][number] {
  return {
    identityId: nullable(row, "identity_id"),
    personId: nullable(row, "person_id"),
    displayName: str(row, "display_name"),
    email: nullable(row, "email"),
  };
}

function mapSourceItem(row: Row): SourceItem {
  return {
    id: str(row, "id"),
    connectorId: str(row, "connector_id"),
    externalId: str(row, "external_id"),
    kind: str(row, "kind") as SourceItem["kind"],
    origin: str(row, "origin") as SourceItem["origin"],
    url: nullable(row, "url"),
    authorIdentityId: nullable(row, "author_identity_id"),
    text: str(row, "text"),
    contentHash: str(row, "content_hash"),
    sensitivity: str(row, "sensitivity") as SourceItem["sensitivity"],
    sections: parse<SourceItem["sections"]>(nullable(row, "sections")),
    occurredAt: str(row, "occurred_at"),
    capturedAt: str(row, "captured_at"),
    updatedAt: str(row, "updated_at"),
    retentionState: str(row, "retention_state") as SourceItem["retentionState"],
  };
}

function loadAttendees(db: Db, meetingId: string): Meeting["attendees"] {
  return db
    .prepare("SELECT * FROM meeting_attendees WHERE meeting_id = ? ORDER BY position")
    .all<Row>(meetingId)
    .map(mapAttendee);
}

function insertAttendees(db: Db, meetingId: string, attendees: Meeting["attendees"]): void {
  const insert = db.prepare(
    "INSERT INTO meeting_attendees (meeting_id, position, identity_id, person_id, display_name, email) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const [position, attendee] of attendees.entries()) {
    insert.run(
      meetingId,
      position,
      attendee.identityId,
      attendee.personId,
      attendee.displayName,
      attendee.email,
    );
  }
}

export function createMeetingsRepo(db: Db, deps: Partial<Deps> = {}): MeetingsRepo {
  const d = { ...defaults, ...deps };
  return {
    upsertExternal(input: ExternalMeeting) {
      const at = toDbInstant(d.now());
      const start = toDbInstant(input.start);
      const end = toDbInstant(input.end);
      const occurredAt = input.occurredAt
        ? toDbInstant(input.occurredAt)
        : toDbInstant(input.start);
      const initial: Meeting = {
        ...input,
        id: d.id("mtg"),
        start,
        end,
        occurredAt,
        capturedAt: at,
        updatedAt: at,
        retentionState: input.retentionState ?? "active",
      };
      return db.transaction(() => {
        try {
          db.prepare(`INSERT INTO meetings
            (id, connector_id, external_id, title, start_at, end_at, all_day, status, self_response,
             classification, classification_source, person_id, action_items, url, occurred_at, captured_at, updated_at, retention_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            initial.id,
            initial.connectorId,
            initial.externalId,
            initial.title,
            initial.start,
            initial.end,
            Number(initial.allDay),
            initial.status,
            initial.selfResponse,
            initial.classification,
            initial.classificationSource,
            initial.personId,
            JSON.stringify(initial.actionItems),
            initial.url,
            initial.occurredAt,
            initial.capturedAt,
            initial.updatedAt,
            initial.retentionState,
          );
          insertAttendees(db, initial.id, initial.attendees);
          return { meeting: initial, created: true };
        } catch (error) {
          if (!isUniqueConstraint(error)) throw error;
          const existingRow = db
            .prepare("SELECT * FROM meetings WHERE connector_id = ? AND external_id = ?")
            .get<Row>(input.connectorId, input.externalId);
          if (!existingRow) throw error;
          const existing = mapMeeting(existingRow, loadAttendees(db, str(existingRow, "id")));
          const preserveUser = existing.classificationSource === "user";
          const updated: Meeting = {
            ...input,
            id: existing.id,
            start,
            end,
            classification: preserveUser ? existing.classification : input.classification,
            classificationSource: existing.classificationSource,
            personId: preserveUser ? existing.personId : input.personId,
            actionItems: input.actionItems,
            attendees: input.attendees,
            occurredAt: input.occurredAt ? toDbInstant(input.occurredAt) : existing.occurredAt,
            capturedAt: existing.capturedAt,
            updatedAt: at,
            retentionState: input.retentionState ?? existing.retentionState,
          };
          db.prepare(`UPDATE meetings SET
            title = ?, start_at = ?, end_at = ?, all_day = ?, status = ?, self_response = ?,
            classification = ?, classification_source = ?, person_id = ?, action_items = ?, url = ?,
            occurred_at = ?, updated_at = ?, retention_state = ?
            WHERE id = ?`).run(
            updated.title,
            updated.start,
            updated.end,
            Number(updated.allDay),
            updated.status,
            updated.selfResponse,
            updated.classification,
            updated.classificationSource,
            updated.personId,
            JSON.stringify(updated.actionItems),
            updated.url,
            updated.occurredAt,
            updated.updatedAt,
            updated.retentionState,
            updated.id,
          );
          db.prepare("DELETE FROM meeting_attendees WHERE meeting_id = ?").run(updated.id);
          insertAttendees(db, updated.id, updated.attendees);
          return { meeting: updated, created: false };
        }
      });
    },
    get(id) {
      const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get<Row>(id);
      return row ? mapMeeting(row, loadAttendees(db, id)) : null;
    },
    listRange(from, to, f = {}) {
      const fromDb = toDbInstant(from);
      const toDb = toDbInstant(to);
      const clauses = ["start_at >= ?", "start_at < ?"];
      const values: unknown[] = [fromDb, toDb];
      if (!f.includeCancelled) {
        clauses.push("status != 'cancelled'");
      }
      if (f.personId !== undefined) {
        clauses.push("person_id = ?");
        values.push(f.personId);
      }
      if (f.classification !== undefined) {
        clauses.push("classification = ?");
        values.push(f.classification);
      }
      const rows = db
        .prepare(
          `SELECT * FROM meetings WHERE ${clauses.join(" AND ")} ORDER BY start_at ASC, id ASC`,
        )
        .all<Row>(...values);
      return rows.map((row) => mapMeeting(row, loadAttendees(db, str(row, "id"))));
    },
    update(id, patch) {
      const current = this.get(id);
      if (!current) throw new ApiError("not_found", "Meeting not found");
      const updated: Meeting = {
        ...current,
        ...patch,
        id,
        classificationSource:
          patch.classification !== undefined ? "user" : current.classificationSource,
        updatedAt: toDbInstant(d.now()),
      };
      db.prepare(`UPDATE meetings SET
        classification = ?, classification_source = ?, person_id = ?, action_items = ?, updated_at = ?
        WHERE id = ?`).run(
        updated.classification,
        updated.classificationSource,
        updated.personId,
        JSON.stringify(updated.actionItems),
        updated.updatedAt,
        id,
      );
      return updated;
    },
    attachNote(meetingId, sourceItemId) {
      const at = toDbInstant(d.now());
      db.prepare("UPDATE meetings SET updated_at = ? WHERE id = ?").run(at, meetingId);
      db.prepare(
        "INSERT OR IGNORE INTO meeting_notes (meeting_id, source_item_id) VALUES (?, ?)",
      ).run(meetingId, sourceItemId);
    },
    notes(meetingId) {
      return db
        .prepare(`SELECT s.* FROM source_items s
          JOIN meeting_notes mn ON mn.source_item_id = s.id
          WHERE mn.meeting_id = ?
          ORDER BY s.occurred_at, s.id`)
        .all<Row>(meetingId)
        .map(mapSourceItem);
    },
    previousOf(meeting, f = {}) {
      const startDb = toDbInstant(meeting.start);
      const clauses = ["start_at < ?"];
      const values: unknown[] = [startDb];
      clauses.push("status != 'cancelled'");
      if (f.classification !== undefined) {
        clauses.push("classification = ?");
        values.push(f.classification);
      }
      if (f.personId !== undefined) {
        clauses.push("person_id = ?");
        values.push(f.personId);
      }
      const row = db
        .prepare(
          `SELECT * FROM meetings WHERE ${clauses.join(" AND ")} ORDER BY start_at DESC, id DESC LIMIT 1`,
        )
        .get<Row>(...values);
      return row ? mapMeeting(row, loadAttendees(db, str(row, "id"))) : null;
    },
  };
}
