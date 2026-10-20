import { z } from "zod";
import { Dated, IsoDateTime, type NewEntity, Sensitivity } from "./common.js";

// Spec 7.1 gives risk and decision only "title, status, owner, date, links, corroborating
// source items". The status values below are a minimal lifecycle; `occurredAt` is the date.
export const RiskStatus = z.enum(["open", "mitigated", "closed"]);
export type RiskStatus = z.infer<typeof RiskStatus>;

export const Risk = Dated.extend({
  id: z.string(),
  title: z.string(),
  status: RiskStatus,
  ownerId: z.string().nullable(),
  links: z.array(z.string()),
  sourceItemIds: z.array(z.string()), // corroborating source items
});
export type Risk = z.infer<typeof Risk>;
export type NewRisk = NewEntity<Risk>;

export const DecisionStatus = z.enum(["proposed", "decided", "superseded"]);
export type DecisionStatus = z.infer<typeof DecisionStatus>;

export const Decision = Dated.extend({
  id: z.string(),
  title: z.string(),
  status: DecisionStatus,
  ownerId: z.string().nullable(),
  links: z.array(z.string()),
  sourceItemIds: z.array(z.string()),
});
export type Decision = z.infer<typeof Decision>;
export type NewDecision = NewEntity<Decision>;

export const DocumentKind = z.enum(["brag_doc", "design_doc", "rubric", "other"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

/** Content lives in `doc_section` source items, each with its own date. */
export const Document = Dated.extend({
  id: z.string(),
  connectorId: z.string(),
  url: z.string(),
  title: z.string(),
  ownerPersonId: z.string().nullable(),
  kind: DocumentKind,
  sharedWithMe: z.boolean(),
  lastModified: IsoDateTime.nullable(),
});
export type Document = z.infer<typeof Document>;
export type NewDocument = NewEntity<Document>;

export const AccomplishmentStatus = z.enum(["proposed", "accepted"]);
export type AccomplishmentStatus = z.infer<typeof AccomplishmentStatus>;

export const Accomplishment = Dated.extend({
  id: z.string(),
  subjectPersonId: z.string(), // self or a report
  summary: z.string(),
  impact: z.string().nullable(),
  tags: z.array(z.string()), // goal / competency tags
  sourceItemIds: z.array(z.string()),
  sensitivity: Sensitivity,
  status: AccomplishmentStatus,
});
export type Accomplishment = z.infer<typeof Accomplishment>;
export type NewAccomplishment = NewEntity<Accomplishment>;

export const AuditActor = z.enum(["user", "import", "system", "mcp"]);
export type AuditActor = z.infer<typeof AuditActor>;

export const AuditEvent = z.object({
  id: z.string(),
  entity: z.string(),
  entityId: z.string(),
  action: z.string(),
  actor: AuditActor,
  at: IsoDateTime,
  note: z.string().nullable(),
  diff: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
