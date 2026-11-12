import type { ExternalMeeting, Profile } from "@emos/api-contract";
import { classifyMeeting, type PeopleRepo } from "@emos/core";
import type { CalendarEventDTO } from "./dto.js";

export interface ApplyDeps {
  connectorId: string;
  people: PeopleRepo;
  profile: Profile;
}

function normalizeResponseStatus(responseStatus: string | null): ExternalMeeting["selfResponse"] {
  if (responseStatus === null) return null;
  const normalized = responseStatus.toLowerCase().replace(/_/g, "");
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
