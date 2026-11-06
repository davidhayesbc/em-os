import { z } from "zod";
import { CommitmentDue } from "./commitment.js";
import { Dated, type NewEntity, Sensitivity } from "./common.js";

export const SourceKind = z.enum([
  "message",
  "thread",
  "email",
  "event",
  "transcript",
  "doc_section",
  "pr",
  "ticket",
  "note",
]);
export type SourceKind = z.infer<typeof SourceKind>;

export const TicketBlocker = z.object({
  sourceTicketId: z.string(),
  status: z.enum(["open", "closed"]),
});
export type TicketBlocker = z.infer<typeof TicketBlocker>;

export const TicketPinProvenance = z.enum(["user", "system"]);
export type TicketPinProvenance = z.infer<typeof TicketPinProvenance>;

/** Structured ticket metadata ingested per source capability. Missing fields degrade to
 * "not blocked" / no signal; no text inference is performed at ingestion time. */
export const TicketData = z.object({
  assigneeIdentityId: z.string().nullable(),
  due: CommitmentDue.nullable(),
  blockers: z.array(TicketBlocker).nullable(),
  pinProvenance: TicketPinProvenance.nullable(),
});
export type TicketData = z.infer<typeof TicketData>;

export const Origin = z.enum(["connector", "import", "mcp_ingest", "manual"]);
export type Origin = z.infer<typeof Origin>;

export const SourceSection = z.object({
  heading: z.string(),
  sensitivity: Sensitivity,
  startLine: z.number().int().min(0),
});
export type SourceSection = z.infer<typeof SourceSection>;

/** `(connectorId, externalId)` is unique. */
export const SourceItem = Dated.extend({
  id: z.string(),
  connectorId: z.string(),
  externalId: z.string(),
  kind: SourceKind,
  origin: Origin,
  url: z.string().nullable(),
  authorIdentityId: z.string().nullable(),
  text: z.string(),
  contentHash: z.string(),
  sensitivity: Sensitivity,
  sections: z.array(SourceSection).nullable(),
  ticket: TicketData.nullable(),
});
export type SourceItem = z.infer<typeof SourceItem>;
export type NewSourceItem = NewEntity<SourceItem>;
