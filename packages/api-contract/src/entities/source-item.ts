import { z } from "zod";
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
});
export type SourceItem = z.infer<typeof SourceItem>;
export type NewSourceItem = NewEntity<SourceItem>;
