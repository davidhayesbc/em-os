import type { Commitment, Goal, Meeting, RankConfig, SourceItem } from "@emos/api-contract";
import {
  buildContext,
  type ComponentKind,
  localDayDiff,
  type RankedItem,
  type ScoreContext,
  scoreCommitment,
} from "./why.js";

export { selectTop } from "./select.js";
export type { ComponentKind, RankedItem };

export function rank(input: {
  now: Date;
  timeZone: string;
  commitments: Commitment[];
  meetings: Meeting[];
  goals: Goal[];
  sourceItems?: SourceItem[];
  config: RankConfig;
}): RankedItem[] {
  const ctx = buildContext(
    input.now,
    input.timeZone,
    input.meetings,
    input.goals,
    input.config,
    input.sourceItems ?? [],
  );
  const byId = new Map(input.commitments.map((c) => [c.id, c]));

  const isAwake = (c: Commitment) => {
    if (c.status === "active") return true;
    if (c.status === "snoozed" && c.snoozedUntil != null) {
      return new Date(c.snoozedUntil).getTime() <= input.now.getTime();
    }
    return false;
  };

  const candidates = input.commitments.filter((c) => {
    if (c.direction !== "mine") return false;
    if (c.retentionState !== "active") return false;
    return isAwake(c);
  });

  const gatedCandidates = candidates.filter((c) => passesTicketGate(c, ctx, candidates, isAwake));

  const scored = gatedCandidates.map((c) => {
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

function isTicketBacked(c: Commitment): boolean {
  return c.ticketId != null;
}

function passesTicketGate(
  c: Commitment,
  ctx: ScoreContext,
  allCandidates: Commitment[],
  isAwake: (c: Commitment) => boolean,
): boolean {
  if (!isTicketBacked(c)) return true;

  const sourceItem = c.ticketId != null ? ctx.sourceItemById.get(c.ticketId) : undefined;
  const ticket = sourceItem?.ticket;

  if (isDueSoon(c, ticket, ctx)) return true;
  if (isBlockedOnMe(c, ctx, allCandidates, isAwake)) return true;
  if (hasExplicitUserPin(c, sourceItem)) return true;

  return false;
}

function isDueSoon(
  c: Commitment,
  ticket: SourceItem["ticket"] | undefined,
  ctx: ScoreContext,
): boolean {
  const due = c.due ?? ticket?.due ?? null;
  if (!due) return false;
  const daysUntil = localDayDiff(ctx.today, due.date, ctx.timeZone);
  return daysUntil <= ctx.config.ticketDueSoonDays;
}

function isBlockedOnMe(
  c: Commitment,
  ctx: ScoreContext,
  allCandidates: Commitment[],
  isAwake: (c: Commitment) => boolean,
): boolean {
  if (!c.ticketId) return false;
  const sourceItem = ctx.sourceItemById.get(c.ticketId);
  if (!sourceItem?.ticket) return false;
  const candidateExternalId = sourceItem.externalId;

  for (const other of allCandidates) {
    if (other.id === c.id) continue;
    if (!isTicketBacked(other)) continue;
    if (!isAwake(other)) continue;

    const otherItem = other.ticketId != null ? ctx.sourceItemById.get(other.ticketId) : undefined;
    if (!otherItem?.ticket) continue;
    if (otherItem.ticket.status !== "open") continue;

    const blockers = otherItem.ticket.blockers;
    if (!blockers) continue;
    if (blockers.some((b) => b.sourceTicketId === candidateExternalId && b.status === "open")) {
      return true;
    }
  }
  return false;
}

function hasExplicitUserPin(c: Commitment, sourceItem?: SourceItem): boolean {
  if (c.pinProvenance === "user") return true;
  if (sourceItem?.ticket?.pinProvenance === "user") return true;
  return false;
}
