import type { AuditActor, AuditEvent } from "@emos/api-contract";
import type { Db } from "../driver.js";

export function createDiff(value: Record<string, unknown>): AuditEvent["diff"] {
  return Object.fromEntries(
    Object.entries(value).map(([field, to]) => [field, { from: null, to: to ?? null }]),
  );
}

export function updateDiff(
  previous: Record<string, unknown>,
  value: Record<string, unknown>,
): AuditEvent["diff"] {
  return Object.fromEntries(
    Object.keys(value)
      .filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(value[field]))
      .map((field) => [field, { from: previous[field] ?? null, to: value[field] ?? null }]),
  );
}

export function appendAudit(
  db: Db,
  id: string,
  entity: string,
  entityId: string,
  action: string,
  actor: AuditActor,
  at: string,
  diff: AuditEvent["diff"],
): void {
  db.prepare(
    "INSERT INTO audit_events (id, entity, entity_id, action, actor, at, note, diff) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
  ).run(id, entity, entityId, action, actor, at, JSON.stringify(diff));
}
