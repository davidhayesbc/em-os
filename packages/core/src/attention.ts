import type {
  AttentionCandidate, AttentionFeedback, AttentionOptions, AttentionPolicy, AttentionWorkItem,
  PullRequestRecord, RankedAttentionItem, ScoreComponent,
} from "./contracts";

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${field}: ${value}`);
  return timestamp;
}
function requireInstant(value: string, field: string): number {
  if (!/(Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error(`${field} must include a timezone: ${value}`);
  return parseTimestamp(value, field);
}
function ageMinutes(observedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - parseTimestamp(observedAt, "timestamp")) / 60_000));
}
function freshness(minutes: number, staleDataHours: number): "fresh" | "stale" {
  return minutes >= staleDataHours * 60 ? "stale" : "fresh";
}

/** Compatibility rule for the original fixture-only PR demo. */
export function findPrAttention(records: readonly PullRequestRecord[], options: AttentionOptions): AttentionCandidate[] {
  const candidates: AttentionCandidate[] = [];
  for (const pr of records) {
    if (pr.isDraft) continue;
    const source = { label: `${pr.repository}#${pr.id}`, url: pr.url };
    if (pr.reviewRequestedOfViewer) {
      const age = ageMinutes(pr.updatedAt, options.now);
      candidates.push({ key: `${pr.provider}:${pr.repository}:${pr.id}:review`, kind: "review-requested", title: pr.title,
        reason: `Review requested from you on ${source.label}`, source, observedAt: pr.updatedAt, ageMinutes: age,
        freshness: freshness(age, options.staleDataHours) });
    }
    if (pr.ciStatus === "failing" && pr.ciUpdatedAt) {
      const age = ageMinutes(pr.ciUpdatedAt, options.now);
      if (age >= options.staleCiHours * 60) candidates.push({ key: `${pr.provider}:${pr.repository}:${pr.id}:stale-ci`,
        kind: "stale-ci", title: pr.title, reason: `CI has been failing for ${Math.floor(age / 60)}h (threshold ${options.staleCiHours}h)`,
        source, observedAt: pr.ciUpdatedAt, ageMinutes: age, freshness: freshness(age, options.staleDataHours) });
    }
  }
  return candidates.sort((a, b) => a.kind.localeCompare(b.kind) || a.source.label.localeCompare(b.source.label) || a.key.localeCompare(b.key));
}

export const DEFAULT_ATTENTION_POLICY: Readonly<AttentionPolicy> = Object.freeze({
  staleDataHours: 6, staleCiHours: 24, dueSoonHours: 48, managerWaitHours: 8, meetingSoonHours: 24,
  maxItems: 20, maxPerKind: 10, minimumScore: 1,
  weights: { priority: 10, blocker: { none: 0, low: 5, medium: 15, high: 30, critical: 50 },
    dueSoon: 20, overdue: 40, managerWait: 20, meetingSoon: 10, reviewRequested: 25, staleCi: 15,
    fresh: 5, lowConfidence: -10, insufficientContext: -5 },
});
function hoursBetween(earlier: string, later: Date, field: string): number {
  return (later.getTime() - requireInstant(earlier, field)) / 3_600_000;
}
function effectiveItem(item: AttentionWorkItem, feedback: readonly AttentionFeedback[]): AttentionWorkItem {
  return feedback.filter((event) => event.action === "correct")
    .reduce<AttentionWorkItem>((value, event) => ({ ...value, ...event.correction }), { ...item });
}

/** Pure deterministic ranking. LLM output is deliberately absent from the API and cannot affect order. */
export function rankAttention(input: readonly AttentionWorkItem[], policy: AttentionPolicy, now: Date,
  feedback: readonly AttentionFeedback[] = []): RankedAttentionItem[] {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid ranking time");
  const ranked: RankedAttentionItem[] = [];
  for (const original of input) {
    // The append-only event order is authoritative. Future-dated audit events are
    // ignored so replaying a snapshot at an earlier instant is deterministic.
    const events = feedback.filter((event) => event.itemId === original.id && requireInstant(event.at, "feedback.at") <= now.getTime());
    const item = effectiveItem(original, events);
    const disposition = [...events].reverse().find((event) => event.action === "dismiss" || event.action === "snooze");
    if (disposition?.action === "dismiss") continue;
    if (disposition?.action === "snooze" && disposition.until && requireInstant(disposition.until, "feedback.until") > now.getTime()) continue;
    const pinned = [...events].reverse().find((event) => event.action === "pin" || event.action === "unpin")?.action === "pin";
    const observedAge = hoursBetween(item.observedAt, now, "observedAt");
    const components: ScoreComponent[] = [];
    const add = (ruleId: string, points: number, explanation: string): void => { if (points !== 0) components.push({ ruleId, points, explanation }); };
    add("priority.explicit", (item.explicitPriority ?? 0) * policy.weights.priority, `Explicit priority ${item.explicitPriority ?? 0}`);
    const severity = item.blockerSeverity ?? "none";
    add(`blocker.${severity}`, policy.weights.blocker[severity], `${severity} blocker severity`);
    if (item.dueAt) {
      const dueHours = (requireInstant(item.dueAt, "dueAt") - now.getTime()) / 3_600_000;
      if (dueHours < 0) add("due.overdue", policy.weights.overdue, "Commitment is overdue");
      else if (dueHours <= policy.dueSoonHours) add("due.soon", policy.weights.dueSoon, `Due within ${policy.dueSoonHours}h`);
    }
    if (item.waitingForManagerSince && hoursBetween(item.waitingForManagerSince, now, "waitingForManagerSince") >= policy.managerWaitHours)
      add("manager.wait", policy.weights.managerWait, `Waiting for manager at least ${policy.managerWaitHours}h`);
    if (item.meetingStartsAt) {
      const meetingHours = (requireInstant(item.meetingStartsAt, "meetingStartsAt") - now.getTime()) / 3_600_000;
      if (meetingHours >= 0 && meetingHours <= policy.meetingSoonHours) add("meeting.imminent", policy.weights.meetingSoon, `Meeting within ${policy.meetingSoonHours}h`);
    }
    if (item.reviewRequested) add("pr.review-requested", policy.weights.reviewRequested, "Your review is requested");
    if (item.ciStatus === "failing" && item.ciUpdatedAt && hoursBetween(item.ciUpdatedAt, now, "ciUpdatedAt") >= policy.staleCiHours)
      add("pr.stale-ci", policy.weights.staleCi, `CI failing at least ${policy.staleCiHours}h`);
    if (observedAge < policy.staleDataHours) add("freshness.fresh", policy.weights.fresh, "Source data is fresh");
    if ((item.confidence ?? 1) < 0.5) add("confidence.low", policy.weights.lowConfidence, "Low-confidence source context");
    const contextStatus = item.identityStatus === "ambiguous" ? "ambiguous-identity" : item.initiativeId ? "sufficient" : "insufficient";
    if (contextStatus !== "sufficient") add("context.insufficient", policy.weights.insufficientContext,
      contextStatus === "ambiguous-identity" ? "Identity is ambiguous; confirmation required" : "Insufficient initiative context");
    const score = components.reduce((sum, component) => sum + component.points, 0);
    if (!pinned && score < policy.minimumScore) continue;
    ranked.push({ key: item.id, kind: item.kind, title: item.title, source: item.source, observedAt: item.observedAt,
      ageMinutes: Math.max(0, Math.floor(observedAge * 60)), freshness: observedAge >= policy.staleDataHours ? "stale" : "fresh",
      banner: observedAge >= policy.staleDataHours ? `Stale data: last observed ${Math.floor(observedAge)}h ago` : `Fresh data: observed ${Math.floor(observedAge * 60)}m ago`,
      reason: components.map((component) => component.explanation).join("; ") || "Pinned by manager", score,
      scoreComponents: components, ruleIds: components.map((component) => component.ruleId), contextStatus, pinned });
  }
  ranked.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score
    || requireInstant(a.observedAt, "observedAt") - requireInstant(b.observedAt, "observedAt")
    || a.key.localeCompare(b.key));
  const counts = new Map<string, number>();
  return ranked.filter((item) => { const count = counts.get(item.kind) ?? 0; if (count >= policy.maxPerKind) return false;
    counts.set(item.kind, count + 1); return true; }).slice(0, policy.maxItems);
}

export function recordAttentionFeedback(history: readonly AttentionFeedback[], event: AttentionFeedback): readonly AttentionFeedback[] {
  if (!event.reason.trim()) throw new Error("Feedback reason is required");
  requireInstant(event.at, "feedback.at");
  if (event.action === "snooze" && !event.until) throw new Error("Snooze requires until");
  if (event.action === "correct" && (!event.correction || Object.keys(event.correction).length === 0))
    throw new Error("Correction requires at least one corrected field");
  if (event.until) requireInstant(event.until, "feedback.until");
  return [...history, { ...event, correction: event.correction ? { ...event.correction } : undefined }];
}
