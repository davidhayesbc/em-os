import type { Goal, GoalStatus, NewGoal } from "@emos/api-contract";

export interface GoalsRepo {
  create(g: NewGoal): Goal;
  update(id: string, patch: Partial<NewGoal>): Goal;
  get(id: string): Goal | null;
  list(f?: { status?: GoalStatus[]; subjectPersonId?: string }): Goal[];
}
