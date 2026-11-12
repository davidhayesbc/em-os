import ICAL from "ical.js";
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
}

function formatAttendee(prop: ICAL.Property): CalendarEventDTO["attendees"][number] {
  const value = String(prop.getFirstValue?.() ?? "");
  const email = value.startsWith("mailto:") ? value.slice(7) : value;
  // ical.js stores parameter names lower-cased in jCal.
  const displayName = (
    prop as unknown as { getParameter(name: string): string | null }
  ).getParameter("cn");
  const responseStatus = (
    prop as unknown as { getParameter(name: string): string | null }
  ).getParameter("partstat");
  return {
    email: email || null,
    displayName: displayName ?? null,
    self: false,
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
  return url ?? null;
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

function buildEventDto(
  event: ICAL.Event,
  startTime: ICAL.Time,
  endTime: ICAL.Time,
  displayZone: string,
): CalendarEventDTO {
  const start = icalTimeToUtcIso(startTime, displayZone);
  const end = icalTimeToUtcIso(endTime, displayZone);

  const attendees: CalendarEventDTO["attendees"] = [];
  for (const prop of event.component.getAllProperties("attendee")) {
    attendees.push(formatAttendee(prop));
  }

  return {
    externalId: `${event.uid}:${start.iso}`,
    title: event.summary,
    start: start.iso,
    end: end.iso,
    allDay: start.allDay,
    status: statusFromIcs(event.component),
    attendees,
    url: urlFromIcs(event.component),
    recurringEventId: event.isRecurring() || event.recurrenceId ? event.uid : null,
  };
}

export function parseIcsEvents(deps: ParseIcsDeps): CalendarEventDTO[] {
  const parsed = ICAL.parse(deps.text);
  const root = new ICAL.Component(parsed);
  const events: CalendarEventDTO[] = [];

  for (const vevent of root.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(vevent);

    if (event.isRecurring()) {
      const iterator = event.iterator();
      for (let next = iterator.next(); next; next = iterator.next()) {
        const occurrence = event.getOccurrenceDetails(next);
        const startDate = new Date(occurrence.startDate.toUnixTime() * 1000);
        if (startDate >= deps.windowEnd) break;
        if (startDate >= deps.windowStart) {
          events.push(
            buildEventDto(event, occurrence.startDate, occurrence.endDate, deps.displayZone),
          );
        }
      }
    } else {
      const startDate = new Date(event.startDate.toUnixTime() * 1000);
      if (startDate >= deps.windowStart && startDate < deps.windowEnd) {
        events.push(buildEventDto(event, event.startDate, event.endDate, deps.displayZone));
      }
    }
  }

  return events;
}
