import { ApiError, type Commitment, type NewCommitment } from "@emos/api-contract";
import { nextOccurrence, transition } from "@emos/core";
import type { Handler, ServiceContext } from "../context.js";

const missing = () => new ApiError("not_found", "Commitment not found");
function get(ctx: ServiceContext, id: string): Commitment {
  const value = ctx.store.commitments.get(id);
  if (!value) throw missing();
  return value;
}
function publish(ctx: ServiceContext, ids: string[]): void {
  ctx.events.publish({ type: "items.changed", entity: "commitment", ids });
}
function exists(ctx: ServiceContext, table: string, id: string | null | undefined): boolean {
  if (!id) return true;
  return Boolean(ctx.db.prepare(`SELECT 1 ok FROM ${table} WHERE id = ?`).get(id));
}
function validateForeignIds(ctx: ServiceContext, value: Partial<NewCommitment>): void {
  for (const [field, table] of [
    ["ownerId", "people"],
    ["counterpartId", "people"],
    ["goalId", "goals"],
    ["meetingId", "meetings"],
  ] as const) {
    if (!exists(ctx, table, value[field])) throw new ApiError("not_found", `${field} not found`);
  }
}
function validateLifecycle(value: NewCommitment): void {
  const valid =
    (value.status === "done") === (value.completedAt !== null) &&
    (value.status === "snoozed") === (value.snoozedUntil !== null) &&
    (value.status === "dropped") === (value.dropReason !== null);
  if (!valid) {
    throw new ApiError("invalid_input", "Commitment lifecycle fields do not match its status");
  }
}
function mutate(
  ctx: ServiceContext,
  id: string,
  action: Parameters<typeof transition>[1],
  args: Parameters<typeof transition>[3] = {},
): Commitment {
  return ctx.store.transaction(() => {
    const value = transition(get(ctx, id), action, ctx.clock.now(), args);
    const saved = ctx.store.commitments.save(value, { action, actor: "user" });
    publish(ctx, [id]);
    return saved;
  });
}

export const commitmentsList: Handler<"commitments.list"> = (ctx, input) =>
  ctx.store.commitments.list(input);
export const commitmentsGet: Handler<"commitments.get"> = (ctx, { id }) => {
  const commitment = get(ctx, id);
  return {
    commitment,
    sources: ctx.store.commitments.sources(id),
    audit: ctx.store.commitments.audit(id),
  };
};
export const commitmentsCreate: Handler<"commitments.create"> = (ctx, input) =>
  ctx.store.transaction(() => {
    const { sourceIds, ...requested } = input;
    validateForeignIds(ctx, requested);
    for (const sourceId of sourceIds ?? []) {
      if (!exists(ctx, "source_items", sourceId)) {
        throw new ApiError("not_found", "sourceId not found");
      }
    }
    const value: NewCommitment =
      requested.createdBy === "user"
        ? requested
        : {
            ...requested,
            status: "proposed",
            completedAt: null,
            dropReason: null,
            snoozedUntil: null,
          };
    validateLifecycle(value);
    const created = ctx.store.commitments.create(value, sourceIds);
    publish(ctx, [created.id]);
    return created;
  });
export const commitmentsUpdate: Handler<"commitments.update"> = (ctx, { id, patch }) =>
  ctx.store.transaction(() => {
    const current = get(ctx, id);
    if (patch.status !== undefined && patch.status !== current.status)
      throw new ApiError("conflict", "Use a transition operation to change status");
    validateForeignIds(ctx, patch);
    const edited = transition({ ...current, ...patch }, "edit", ctx.clock.now());
    const saved = ctx.store.commitments.save(edited, { action: "edit", actor: "user" });
    publish(ctx, [id]);
    return saved;
  });
export const commitmentsComplete: Handler<"commitments.complete"> = (ctx, { id }) =>
  ctx.store.transaction(() => {
    const current = get(ctx, id);
    let completed = transition(current, "complete", ctx.clock.now());
    const ids = [id];
    if (current.recurrence) {
      const seriesId = current.seriesId ?? current.id;
      completed = { ...completed, seriesId };
      const after =
        current.due?.date ??
        (ctx.clock.now().toISOString().slice(0, 10) as Commitment["due"] extends {
          date: infer D;
        } | null
          ? D
          : never);
      const due = {
        date: nextOccurrence(current.recurrence, after),
        time: current.due?.time ?? null,
        timeZone: current.due?.timeZone ?? "UTC",
      };
      const { id: _id, capturedAt: _captured, updatedAt: _updated, ...rest } = current;
      const next = ctx.store.commitments.create({
        ...rest,
        status: "active",
        dropReason: null,
        completedAt: null,
        snoozedUntil: null,
        seriesId,
        due,
        occurredAt: ctx.clock.now().toISOString(),
      });
      ids.push(next.id);
    }
    ctx.store.commitments.save(completed, { action: "complete", actor: "user" });
    publish(ctx, ids);
    return completed;
  });
export const commitmentsSnooze: Handler<"commitments.snooze"> = (ctx, { id, until }) =>
  mutate(ctx, id, "snooze", { until });
export const commitmentsDrop: Handler<"commitments.drop"> = (ctx, { id, reason }) =>
  mutate(ctx, id, "drop", { reason });
export function commitmentsReopen(
  ctx: ServiceContext,
  { id }: { id: string },
  actor: "user" | "import" | "system" = "user",
): Commitment {
  if (actor !== "user") throw new ApiError("conflict", "Only a user can reopen a commitment");
  return mutate(ctx, id, "reopen");
}
export const commitmentsReopenHandler: Handler<"commitments.reopen"> = (ctx, input) =>
  commitmentsReopen(ctx, input);
export const commitmentsPin: Handler<"commitments.pin"> = (ctx, { id, pinned }) =>
  mutate(ctx, id, pinned ? "pin" : "unpin");
