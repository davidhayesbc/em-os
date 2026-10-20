import { z } from "zod";
import { Dated, IsoDateTime, type NewEntity } from "./common.js";

export const Classification = z.enum(["one_on_one", "standup", "team", "external", "other"]);
export type Classification = z.infer<typeof Classification>;

export const MeetingAttendee = z.object({
  identityId: z.string().nullable(),
  personId: z.string().nullable(),
  displayName: z.string(),
  email: z.string().nullable(),
});
export type MeetingAttendee = z.infer<typeof MeetingAttendee>;

/** Other attendees' action items: stored on the meeting, not on the user's list. */
export const MeetingActionItem = z.object({
  text: z.string(),
  ownerName: z.string().nullable(),
  done: z.boolean(),
});
export type MeetingActionItem = z.infer<typeof MeetingActionItem>;

export const Meeting = Dated.extend({
  id: z.string(),
  connectorId: z.string(),
  externalId: z.string(),
  title: z.string(),
  start: IsoDateTime,
  end: IsoDateTime,
  allDay: z.boolean(),
  status: z.enum(["confirmed", "cancelled"]),
  selfResponse: z.enum(["accepted", "tentative", "declined", "needs_action"]).nullable(),
  classification: Classification,
  classificationSource: z.enum(["auto", "user"]),
  personId: z.string().nullable(), // the other party of a 1:1
  attendees: z.array(MeetingAttendee),
  actionItems: z.array(MeetingActionItem),
  url: z.string().nullable(),
});
export type Meeting = z.infer<typeof Meeting>;
export type NewMeeting = NewEntity<Meeting>;

/** A meeting imported from a calendar connector: identified by (connectorId, externalId). */
export type ExternalMeeting = NewMeeting & { connectorId: string; externalId: string };
