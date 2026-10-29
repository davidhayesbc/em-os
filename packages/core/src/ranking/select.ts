import type { Commitment, Goal } from "@emos/api-contract";
import type { RankedItem } from "./why.js";

export function selectTop(
  ranked: RankedItem[],
  commitments: Map<string, Commitment>,
  goals: Map<string, Goal>,
  config: { topN: number; goalSlots: number },
): RankedItem[] {
  const isExcluded = (r: RankedItem) => {
    const c = commitments.get(r.commitmentId);
    if (!c) return true;
    return (c.urgency === "later" || c.urgency === "someday") && c.due == null;
  };

  // Qualifying goal = a commitment whose goalId resolves to an active goal record.
  const isGoalLinked = (r: RankedItem) => {
    const c = commitments.get(r.commitmentId);
    return c?.goalId != null && goals.get(c.goalId)?.status === "active";
  };

  const eligible = ranked.filter((r) => !isExcluded(r));

  const topIds = new Set(eligible.slice(0, config.topN).map((r) => r.commitmentId));
  if (topIds.size === 0 || config.goalSlots === 0) {
    return eligible.slice(0, config.topN);
  }

  const goalCount = eligible.slice(0, config.topN).filter((r) => isGoalLinked(r)).length;
  const needed = Math.max(0, Math.min(config.goalSlots, config.topN) - goalCount);
  if (needed > 0) {
    const outsideGoals = eligible
      .slice(config.topN)
      .filter((r) => isGoalLinked(r) && !topIds.has(r.commitmentId));
    const removable = eligible.slice(0, config.topN).filter((r) => !isGoalLinked(r));
    let replaced = 0;
    for (
      let i = removable.length - 1;
      i >= 0 && replaced < needed && outsideGoals.length > 0;
      i--
    ) {
      const toRemove = removable[i];
      if (!toRemove) continue;
      topIds.delete(toRemove.commitmentId);
      const goal = outsideGoals.shift();
      if (goal) {
        topIds.add(goal.commitmentId);
        replaced++;
      }
    }
  }

  return eligible.filter((r) => topIds.has(r.commitmentId));
}
