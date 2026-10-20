import { z } from "zod";
import { Dated, LocalDate, type NewEntity, Sensitivity } from "./common.js";

export const GoalHorizon = z.enum(["quarter", "half", "ongoing"]);
export type GoalHorizon = z.infer<typeof GoalHorizon>;

export const GoalKind = z.enum(["team", "project", "personal_growth"]);
export type GoalKind = z.infer<typeof GoalKind>;

// Spec 7.1 does not enumerate goal statuses; this is the minimal lifecycle Phase 1 needs.
export const GoalStatus = z.enum(["active", "achieved", "dropped"]);
export type GoalStatus = z.infer<typeof GoalStatus>;

export const Goal = Dated.extend({
  id: z.string(),
  title: z.string(),
  slug: z.string().nullable(), // unique; resolves `#ws:` tags
  subjectPersonId: z.string(), // self by default; a direct report for growth goals
  horizon: GoalHorizon,
  kind: GoalKind,
  status: GoalStatus,
  targetDate: LocalDate.nullable(),
  sensitivity: Sensitivity,
});
export type Goal = z.infer<typeof Goal>;
export type NewGoal = NewEntity<Goal>;
