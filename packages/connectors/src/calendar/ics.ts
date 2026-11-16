import ICAL from "ical.js";
import { ConnectorError } from "../runtime/errors.js";
import type { CalendarEventDTO } from "./dto.js";

export interface ParseIcsDeps {
  /** Raw ICS text. */
  text: string;
  /** Inclusive start of the sync window (UTC). */
  windowStart: Date;
  /** Exclusive end of the sync window (UTC). */
  windowEnd: Date;
  /** IANA time zone used to interpret all-day events. */
  displayZone: string;
  /** Optional self attendee email used to mark the owner's participation. */
  selfEmail?: string | null;
}

/** Maximum ICS file size accepted by the file transport. */
export const MAX_ICS_FILE_BYTES = 5 * 1024 * 1024;

const MAX_OCCURRENCES_PER_EVENT = 500;
const MAX_ITERATIONS_PER_EVENT = 20_000;
const MAX_EVENTS_TOTAL = 2000;
const MAX_TITLE_LENGTH = 2000;
const MAX_EXTERNAL_ID_LENGTH = 2000;
const MAX_ATTENDEE_EMAIL_LENGTH = 254;
const MAX_ATTENDEE_DISPLAY_NAME_LENGTH = 500;

const ICS_RECURRENCE_PER_EVENT_LIMIT_MESSAGE =
  "Calendar ICS recurrence expansion exceeded the per-event limit";
const ICS_RECURRENCE_TOTAL_LIMIT_MESSAGE =
  "Calendar ICS recurrence expansion exceeded the total event limit";
const ICS_RECURRENCE_ITERATION_LIMIT_MESSAGE =
  "Calendar ICS recurrence expansion exceeded the iteration limit";
const ICS_FIELD_TOO_LONG_MESSAGE = "Calendar ICS event field exceeds maximum length";

/**
 * Removes C0/C1 control characters and Unicode format characters from a user-supplied
 * ICS value before it reaches the database.
 */
function sanitizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

/**
 * Allow-lists ICS URL values to http/https schemes only. Everything else is dropped
 * to null so a stored URL can never be rendered as an executable link.
 */
function sanitizeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http:") || lower.startsWith("https:")) return trimmed;
  return null;
}

function assertStringLength(value: string, max: number): void {
  if (value.length > max) {
    throw new ConnectorError("schema", ICS_FIELD_TOO_LONG_MESSAGE);
  }
}

function formatAttendee(
  prop: ICAL.Property,
  selfEmail: string | null | undefined,
): CalendarEventDTO["attendees"][number] {
  const rawValue = String(prop.getFirstValue?.() ?? "");
  const rawEmail = rawValue.startsWith("mailto:") ? rawValue.slice(7) : rawValue;
  const email = sanitizeString(rawEmail);
  if (email !== null) {
    assertStringLength(email, MAX_ATTENDEE_EMAIL_LENGTH);
  }

  // ical.js stores parameter names lower-cased in jCal.
  const rawCn = (prop as unknown as { getParameter(name: string): string | null }).getParameter(
    "cn",
  );
  const displayName = sanitizeString(rawCn);
  if (displayName !== null) {
    assertStringLength(displayName, MAX_ATTENDEE_DISPLAY_NAME_LENGTH);
  }

  const responseStatus = (
    prop as unknown as { getParameter(name: string): string | null }
  ).getParameter("partstat");
  const isSelf = !!(email && selfEmail && email.toLowerCase() === selfEmail.toLowerCase());
  return {
    email: email || null,
    displayName: displayName ?? null,
    self: isSelf,
    responseStatus: responseStatus?.toLowerCase() ?? null,
  };
}

function statusFromIcs(component: ICAL.Component): CalendarEventDTO["status"] {
  const status = (
    component as unknown as { getFirstPropertyValue(name: string): string | null }
  ).getFirstPropertyValue("status");
  if (!status) return "confirmed";
  switch (status.toUpperCase()) {
    case "CANCELLED":
      return "cancelled";
    case "TENTATIVE":
      return "tentative";
    default:
      return "confirmed";
  }
}

function urlFromIcs(component: ICAL.Component): string | null {
  const url = (
    component as unknown as { getFirstPropertyValue(name: string): string | null }
  ).getFirstPropertyValue("url");
  return typeof url === "string" ? url : null;
}

/** Compute the UTC instant for local midnight of `date` in `zone`. */
function localMidnightUtc(date: string, zone: string): string {
  const parts = date.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  const dtFormatParts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utcMidnight));
  const get = (type: string) => Number(dtFormatParts.find((p) => p.type === type)?.value ?? "0");
  const zYear = get("year");
  const zMonth = get("month");
  const zDay = get("day");
  const zHour = get("hour");
  const zMinute = get("minute");
  const zSecond = get("second");
  const localMsAtUtcMidnight = Date.UTC(zYear, zMonth - 1, zDay, zHour, zMinute, zSecond);
  const offsetMs = localMsAtUtcMidnight - utcMidnight;
  const localMidnightMs = utcMidnight - offsetMs;
  return new Date(localMidnightMs).toISOString();
}

function icalTimeToUtcIso(
  time: ICAL.Time,
  displayZone: string,
): {
  iso: string;
  allDay: boolean;
} {
  if (time.isDate) {
    const dateStr =
      String(time.year).padStart(4, "0") +
      "-" +
      String(time.month).padStart(2, "0") +
      "-" +
      String(time.day).padStart(2, "0");
    return { iso: localMidnightUtc(dateStr, displayZone), allDay: true };
  }
  return { iso: new Date(time.toUnixTime() * 1000).toISOString(), allDay: false };
}

/** Internal draft used before the final DTO validation pass. */
type CalendarEventDraft = Omit<CalendarEventDTO, "title"> & { title: string | null };

function buildEventDto(
  event: ICAL.Event,
  startTime: ICAL.Time,
  endTime: ICAL.Time,
  displayZone: string,
  selfEmail: string | null | undefined,
): CalendarEventDraft {
  const start = icalTimeToUtcIso(startTime, displayZone);
  const end = icalTimeToUtcIso(endTime, displayZone);

  const rawUid = typeof event.uid === "string" ? event.uid : "";
  const externalId = `${rawUid}:${start.iso}`;
  assertStringLength(externalId, MAX_EXTERNAL_ID_LENGTH);

  const title = sanitizeString(event.summary);
  if (title !== null) {
    assertStringLength(title, MAX_TITLE_LENGTH);
  }

  const attendees: CalendarEventDTO["attendees"] = [];
  for (const prop of event.component.getAllProperties("attendee")) {
    attendees.push(formatAttendee(prop, selfEmail));
  }

  return {
    externalId,
    title,
    start: start.iso,
    end: end.iso,
    allDay: start.allDay,
    status: statusFromIcs(event.component),
    attendees,
    url: sanitizeUrl(urlFromIcs(event.component)),
    recurringEventId: event.isRecurring() || event.recurrenceId ? event.uid : null,
  };
}

export function parseIcsEvents(deps: ParseIcsDeps): CalendarEventDraft[] {
  const parsed = ICAL.parse(deps.text);
  const root = new ICAL.Component(parsed);
  const events: CalendarEventDraft[] = [];
  const selfEmail = deps.selfEmail;
  let totalCount = 0;

  for (const vevent of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);

    if (event.isRecurring()) {
      const iterator = event.iterator();
      let iterationCount = 0;
      let perEventCount = 0;
      for (let next = iterator.next(); next; next = iterator.next()) {
        iterationCount++;
        if (iterationCount > MAX_ITERATIONS_PER_EVENT) {
          throw new ConnectorError("schema", ICS_RECURRENCE_ITERATION_LIMIT_MESSAGE);
        }
        const occurrence = event.getOccurrenceDetails(next);
        const startDate = new Date(occurrence.startDate.toUnixTime() * 1000);
        if (startDate >= deps.windowEnd) break;
        if (startDate >= deps.windowStart) {
          perEventCount++;
          if (perEventCount > MAX_OCCURRENCES_PER_EVENT) {
            throw new ConnectorError("schema", ICS_RECURRENCE_PER_EVENT_LIMIT_MESSAGE);
          }
          totalCount++;
          if (totalCount > MAX_EVENTS_TOTAL) {
            throw new ConnectorError("schema", ICS_RECURRENCE_TOTAL_LIMIT_MESSAGE);
          }
          events.push(
            buildEventDto(
              event,
              occurrence.startDate,
              occurrence.endDate,
              deps.displayZone,
              selfEmail,
            ),
          );
        }
      }
    } else {
      const startDate = new Date(event.startDate.toUnixTime() * 1000);
      if (startDate >= deps.windowStart && startDate < deps.windowEnd) {
        totalCount++;
        if (totalCount > MAX_EVENTS_TOTAL) {
          throw new ConnectorError("schema", ICS_RECURRENCE_TOTAL_LIMIT_MESSAGE);
        }
        events.push(
          buildEventDto(event, event.startDate, event.endDate, deps.displayZone, selfEmail),
        );
      }
    }
  }

  return events;
}
