import { z } from "zod";
import { Dated, type NewEntity, Sensitivity, TimeZone } from "./common.js";

export const Relationship = z.enum([
  "self",
  "direct_report",
  "manager",
  "peer",
  "stakeholder",
  "other",
]);
export type Relationship = z.infer<typeof Relationship>;

export const Person = Dated.extend({
  id: z.string(),
  displayName: z.string(),
  relationship: Relationship,
  pronouns: z.string().nullable(), // null = unknown
  aliases: z.array(z.string()),
  role: z.string().nullable(),
  timeZone: TimeZone.nullable(), // null = unknown
  archived: z.boolean(),
  oneOnOneCadenceDays: z.number().int().positive().nullable(),
});
export type Person = z.infer<typeof Person>;
export type NewPerson = NewEntity<Person>;

export const IdentitySource = z.enum([
  "chat",
  "code_host",
  "email",
  "calendar",
  "tickets",
  "docs",
  "other",
]);
export type IdentitySource = z.infer<typeof IdentitySource>;

/** A handle on one source. People are never auto-merged by display name alone. */
export const Identity = Dated.extend({
  id: z.string(),
  personId: z.string(),
  source: IdentitySource,
  handle: z.string(), // handle or external id
  confirmed: z.boolean(),
});
export type Identity = z.infer<typeof Identity>;
export type NewIdentity = NewEntity<Identity>;

export const NoteOrigin = z.enum(["manual", "import", "mcp"]);
export type NoteOrigin = z.infer<typeof NoteOrigin>;

export const ReviewState = z.enum(["proposed", "accepted"]);
export type ReviewState = z.infer<typeof ReviewState>;

/** `occurredAt` is the user-settable note date. */
export const PersonNote = Dated.extend({
  id: z.string(),
  personId: z.string(),
  text: z.string(),
  tags: z.array(z.string()),
  sourceUrl: z.string().nullable(),
  sensitivity: Sensitivity.default("people_sensitive"),
  origin: NoteOrigin,
  reviewState: ReviewState.default("accepted"), // MCP-created notes start "proposed"
});
export type PersonNote = z.infer<typeof PersonNote>;
export type NewPersonNote = NewEntity<PersonNote>;
