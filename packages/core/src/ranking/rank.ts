import type { Commitment, Goal, Meeting, RankConfig } from "@emos/api-contract";
import { buildContext, type ComponentKind, type RankedItem, scoreCommitment } from "./why.js";

export { selectTop } from "./select.js";
export type { ComponentKind, RankedItem };

export function rank(input: {
  now: Date;
  timeZone: string;
  commitments: Commitment[];
  meetings: Meeting[];
  goals: Goal[];
  config: RankConfig;
}): RankedItem[] {
  const ctx = buildContext(input.now, input.timeZone, input.meetings, input.goals, input.config);
  const byId = new Map(input.commitments.map((c) => [c.id, c]));

  const candidates = input.commitments.filter((c) => {
    if (c.direction !== "mine") return false;
    if (c.retentionState !== "active") return false;
    if (c.status === "active") return true;
    if (c.status === "snoozed" && c.snoozedUntil != null) {
      return new Date(c.snoozedUntil).getTime() <= input.now.getTime();
    }
    return false;
  });

  const scored = candidates.map((c) => {
    const scored = scoreCommitment(c, ctx);
    const score = scored.components.reduce((sum, comp) => sum + comp.points, 0);
    return {
      commitmentId: c.id,
      score,
      dominant: scored.dominant.kind,
      why: scored.why,
      components: scored.components,
    } satisfies RankedItem;
  });

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const aC = byId.get(a.commitmentId);
    const bC = byId.get(b.commitmentId);

    const aDue = aC?.due?.date ?? null;
    const bDue = bC?.due?.date ?? null;
    if (aDue !== bDue) {
      if (aDue == null) return 1;
      if (bDue == null) return -1;
      return aDue > bDue ? 1 : -1;
    }

    // Chronological capture instant tie-break; lexical comparison would mis-order
    // seconds-only and fractional ISO-8601 representations of the same instant.
    const aCapMs = aC?.capturedAt ? new Date(aC.capturedAt).getTime() : Number.POSITIVE_INFINITY;
    const bCapMs = bC?.capturedAt ? new Date(bC.capturedAt).getTime() : Number.POSITIVE_INFINITY;
    if (aCapMs !== bCapMs) return aCapMs - bCapMs;

    return a.commitmentId > b.commitmentId ? 1 : -1;
  });
}
