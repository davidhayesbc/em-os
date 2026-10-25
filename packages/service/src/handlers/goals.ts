import { ApiError } from "@emos/api-contract";
import type { Handler } from "../context.js";

const personExists = (ctx: Parameters<Handler<"goals.create">>[0], id: string) =>
  Boolean(ctx.db.prepare("SELECT 1 ok FROM people WHERE id=?").get(id));
export const goalsList: Handler<"goals.list"> = (ctx, input) => ctx.store.goals.list(input);
export const goalsCreate: Handler<"goals.create"> = (ctx, input) =>
  ctx.store.transaction(() => {
    if (!personExists(ctx, input.subjectPersonId))
      throw new ApiError("not_found", "subjectPersonId not found");
    const value = ctx.store.goals.create(input);
    ctx.events.publish({ type: "items.changed", entity: "goal", ids: [value.id] });
    return value;
  });
export const goalsUpdate: Handler<"goals.update"> = (ctx, { id, patch }) =>
  ctx.store.transaction(() => {
    if (patch.subjectPersonId && !personExists(ctx, patch.subjectPersonId))
      throw new ApiError("not_found", "subjectPersonId not found");
    const value = ctx.store.goals.update(id, patch);
    ctx.events.publish({ type: "items.changed", entity: "goal", ids: [id] });
    return value;
  });
