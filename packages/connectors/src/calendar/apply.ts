import type { ExternalMeeting, Profile } from "@emos/api-contract";
import { classifyMeeting, type PeopleRepo } from "@emos/core";
import { ConnectorError } from "../runtime/errors.js";
import type { CalendarEventDTO } from "./dto.js";
import {
  MAX_ATTENDEE_DISPLAY_NAME_LENGTH,
  MAX_ATTENDEE_EMAIL_LENGTH,
  MAX_TITLE_LENGTH,
  sanitizeString,
  sanitizeUrl,
} from "./ics.js";

export interface ApplyDeps {
  connectorId: string;
  people: PeopleRepo;
  profile: Profile;
}

function normalizeResponseStatus(responseStatus: string | null): ExternalMeeting["selfResponse"] {
  if (responseStatus === null) return null;
  const normalized = responseStatus.toLowerCase().replace(/[_-]/g, "");
  switch (normalized) {
    case "accepted":
      return "accepted";
    case "tentative":
      return "tentative";
    case "declined":
      return "declined";
    case "needsaction":
      return "needs_action";
    default:
      return null;
  }
}

function normalizeStatus(status: CalendarEventDTO["status"]): ExternalMeeting["status"] {
  return status === "cancelled" ? "cancelled" : "confirmed";
}

const TITLE_MISSING_MESSAGE = "Calendar event title is missing or empty";
const TITLE_TOO_LONG_MESSAGE = "Calendar event title exceeds maximum length";
const ATTENDEE_EMAIL_TOO_LONG_MESSAGE = "Calendar attendee email exceeds maximum length";
const ATTENDEE_DISPLAY_NAME_TOO_LONG_MESSAGE =
  "Calendar attendee display name exceeds maximum length";

/**
 * Shared character/length normalization for the CalendarEventDTO boundary. Used by
 * both the MCP and ICS transports so every persisted row passes through the same
 * control/format-character stripping, length caps, and URL allow-list.
 */
export function normalizeEventDto(dto: CalendarEventDTO): CalendarEventDTO {
  const title = sanitizeString(dto.title);
  if (title === null || title.length === 0) {
    throw new ConnectorError("schema", TITLE_MISSING_MESSAGE);
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ConnectorError("schema", TITLE_TOO_LONG_MESSAGE);
  }

  const attendees = dto.attendees.map((attendee) => {
    const sanitizedEmail = attendee.email !== null ? sanitizeString(attendee.email) : null;
    const email = sanitizedEmail && sanitizedEmail.length > 0 ? sanitizedEmail : null;
    if (email !== null && email.length > MAX_ATTENDEE_EMAIL_LENGTH) {
      throw new ConnectorError("schema", ATTENDEE_EMAIL_TOO_LONG_MESSAGE);
    }

    const sanitizedDisplayName =
      attendee.displayName !== null ? sanitizeString(attendee.displayName) : null;
    const displayName = sanitizedDisplayName ?? null;
    if (displayName !== null && displayName.length > MAX_ATTENDEE_DISPLAY_NAME_LENGTH) {
      throw new ConnectorError("schema", ATTENDEE_DISPLAY_NAME_TOO_LONG_MESSAGE);
    }

    return { ...attendee, email, displayName };
  });

  const url = sanitizeUrl(dto.url);

  return { ...dto, title, attendees, url };
}

export function applyCalendarEvent(dto: CalendarEventDTO, deps: ApplyDeps): ExternalMeeting {
  const attendees: ExternalMeeting["attendees"] = dto.attendees.map((attendee) => {
    const identity = attendee.email ? deps.people.findIdentity("email", attendee.email) : null;
    return {
      identityId: identity?.id ?? null,
      personId: identity?.personId ?? null,
      displayName: attendee.displayName ?? attendee.email ?? "",
      email: attendee.email,
    };
  });

  const selfAttendee = dto.attendees.find((a) => a.self);

  const meeting: ExternalMeeting = {
    connectorId: deps.connectorId,
    externalId: dto.externalId,
    title: dto.title,
    start: dto.start,
    end: dto.end,
    allDay: dto.allDay,
    status: normalizeStatus(dto.status),
    selfResponse: selfAttendee ? normalizeResponseStatus(selfAttendee.responseStatus) : null,
    classification: "other",
    classificationSource: "auto",
    personId: null,
    attendees,
    actionItems: [],
    url: dto.url,
    occurredAt: dto.start,
  };

  const { classification, personId } = classifyMeeting(
    meeting as unknown as Parameters<typeof classifyMeeting>[0],
    deps.profile.meetingRules,
    deps.profile.selfPersonId,
  );
  meeting.classification = classification;
  meeting.personId = personId;

  return meeting;
}
