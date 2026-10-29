import type { Commitment } from "@emos/api-contract";
import type { RankedItem } from "./why.js";

export function selectTop(
  ranked: RankedItem[],
  commitments: Map<string, Commitment>,
  config: { topN: number; goalSlots: number },
): RankedItem[] {
  const isExcluded = (r: RankedItem) => {
    const c = commitments.get(r.commitmentId);
    if (!c) return true;
    return (c.urgency === "later" || c.urgency === "someday") && c.due == null;
  };

  const eligible = ranked.filter((r) => !isExcluded(r));
  let top = eligible.slice(0, config.topN);
  if (top.length === 0) return top;

  const goalCount = top.filter((r) => commitments.get(r.commitmentId)?.goalId).length;
  const needed = Math.max(0, config.goalSlots - goalCount);
  if (needed > 0) {
    const inTop = new Set(top.map((r) => r.commitmentId));
    const outsideGoals = eligible.slice(config.topN).filter((r) => {
      const c = commitments.get(r.commitmentId);
      return c?.goalId != null && !inTop.has(r.commitmentId);
    });
    const replacements = outsideGoals.slice(0, Math.min(needed, top.length));
    if (replacements.length > 0) {
      top = top.slice(0, top.length - replacements.length).concat(replacements);
    }
  }

  return top;
}
