import { z } from "zod";
import { CommitmentDue } from "./commitment.js";
import { Dated, Sensitivity } from "./common.js";

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
  /** Scoped to the connector that provided this source item; cross-connector matching is
   *  defined by the ranking layer. */
  sourceTicketId: z.string(),
  /** Status of the related (blocking) ticket, not of this commitment/source item. */
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
  /** The ticket's own tracker status. `null` or omitted means the connector did not
   *  provide a status, which degrades to "not blocked" / no signal for gate evaluation. */
  status: z.enum(["open", "closed"]).nullable().default(null),
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
export type NewSourceItem = Omit<
  SourceItem,
  "id" | "capturedAt" | "updatedAt" | "occurredAt" | "retentionState" | "ticket"
> &
  Partial<Pick<SourceItem, "occurredAt" | "retentionState" | "ticket">>;

/** Public wire view of a source item: structured ticket metadata stays server-side. */
export const SourceItemView = SourceItem.omit({ ticket: true });
export type SourceItemView = z.infer<typeof SourceItemView>;
