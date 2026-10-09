import type { AttentionCandidate, AttentionOptions, PullRequestRecord } from "./contracts";

function parseTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${field}: ${value}`);
  return timestamp;
}

function ageMinutes(observedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - parseTimestamp(observedAt, "timestamp")) / 60_000));
}

function freshness(minutes: number, staleDataHours: number): "fresh" | "stale" {
  return minutes >= staleDataHours * 60 ? "stale" : "fresh";
}

export function findPrAttention(records: readonly PullRequestRecord[], options: AttentionOptions): AttentionCandidate[] {
  const candidates: AttentionCandidate[] = [];
  for (const pr of records) {
    if (pr.isDraft) continue;
    const source = { label: `${pr.repository}#${pr.id}`, url: pr.url };
    if (pr.reviewRequestedOfViewer) {
      const age = ageMinutes(pr.updatedAt, options.now);
      candidates.push({
        key: `${pr.provider}:${pr.repository}:${pr.id}:review`,
        kind: "review-requested",
        title: pr.title,
        reason: `Review requested from you on ${source.label}`,
        source,
        observedAt: pr.updatedAt,
        ageMinutes: age,
        freshness: freshness(age, options.staleDataHours),
      });
    }
    if (pr.ciStatus === "failing" && pr.ciUpdatedAt) {
      const age = ageMinutes(pr.ciUpdatedAt, options.now);
      if (age >= options.staleCiHours * 60) {
        candidates.push({
          key: `${pr.provider}:${pr.repository}:${pr.id}:stale-ci`,
          kind: "stale-ci",
          title: pr.title,
          reason: `CI has been failing for ${Math.floor(age / 60)}h (threshold ${options.staleCiHours}h)`,
          source,
          observedAt: pr.ciUpdatedAt,
          ageMinutes: age,
          freshness: freshness(age, options.staleDataHours),
        });
      }
    }
  }
  return candidates.sort((a, b) => a.kind.localeCompare(b.kind) || a.source.label.localeCompare(b.source.label) || a.key.localeCompare(b.key));
}
