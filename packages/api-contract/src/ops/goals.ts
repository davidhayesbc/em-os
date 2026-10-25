import { z } from "zod";
import { Goal, GoalStatus } from "../entities/index.js";
import { defineOp } from "../op.js";

const NewGoal = Goal.omit({
  id: true,
  capturedAt: true,
  updatedAt: true,
  occurredAt: true,
  retentionState: true,
}).extend({
  occurredAt: Goal.shape.occurredAt.optional(),
  retentionState: Goal.shape.retentionState.optional(),
});
export const goalsList = defineOp({
  name: "goals.list",
  input: z.object({
    status: z.array(GoalStatus).optional(),
    subjectPersonId: z.string().optional(),
  }),
  output: z.array(Goal),
});
export const goalsCreate = defineOp({ name: "goals.create", input: NewGoal, output: Goal });
export const goalsUpdate = defineOp({
  name: "goals.update",
  input: z.object({ id: z.string(), patch: NewGoal.partial() }),
  output: Goal,
});
