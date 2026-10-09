export type ActionStatus = "proposed" | "confirmed" | "completed" | "snoozed";
export type Freshness = "fresh" | "stale";

export interface QueueItem {
  id: string;
  title: string;
  rationale: string;
  sourceLabel: string;
  sourceUrl: string;
  provenance: string;
  observedAt: string;
  dueAt?: string;
  freshness: Freshness;
  status: ActionStatus;
  snoozedUntil?: string;
}

export interface QueueSnapshot {
  generatedAt: string;
  lastSyncAt?: string;
  syncError?: string;
  permissionNotice: string;
  offline: boolean;
  items: readonly QueueItem[];
}

export type QueueChange =
  | { type: "confirm"; id: string }
  | { type: "complete"; id: string }
  | { type: "snooze"; id: string; until: string };

export interface SourceOpener {
  open(url: string): Promise<void>;
}

export const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

export function isSnapshotStale(snapshot: QueueSnapshot, now: Date): boolean {
  const generatedAt = Date.parse(snapshot.generatedAt);
  return snapshot.offline || Boolean(snapshot.syncError) ||
    !Number.isFinite(generatedAt) || now.getTime() - generatedAt > SNAPSHOT_MAX_AGE_MS ||
    snapshot.items.some((item) => item.freshness === "stale");
}

export function effectiveItemFreshness(snapshot: QueueSnapshot, item: QueueItem, now: Date): Freshness {
  return isSnapshotStale(snapshot, now) || item.freshness === "stale" ? "stale" : "fresh";
}

export function mergeQueueSnapshot(previous: QueueSnapshot, refreshed: QueueSnapshot): QueueSnapshot {
  const previousById = new Map(previous.items.map((item) => [item.id, item]));
  const refreshedIds = new Set(refreshed.items.map((item) => item.id));
  const items = refreshed.items.map((item): QueueItem => {
    const existing = previousById.get(item.id);
    if (!existing) return item;
    return {
      ...item,
      status: existing.status,
      snoozedUntil: existing.status === "snoozed" ? existing.snoozedUntil : undefined,
    };
  });

  // Keep completion tombstones so a later refresh cannot reopen an item merely
  // because it temporarily disappeared from its source.
  for (const item of previous.items) {
    if (item.status === "completed" && !refreshedIds.has(item.id)) items.push(item);
  }
  return { ...refreshed, items };
}

function assertUrl(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Source links must use HTTP(S)");
}

export class AttentionQueue {
  readonly snapshot: QueueSnapshot;

  constructor(snapshot: QueueSnapshot) {
    this.snapshot = snapshot;
  }

  visible(now: Date): readonly QueueItem[] {
    return this.snapshot.items.filter((item) => item.status !== "completed" &&
      (item.status !== "snoozed" || !item.snoozedUntil || Date.parse(item.snoozedUntil) <= now.getTime()));
  }

  change(change: QueueChange): AttentionQueue {
    const items = this.snapshot.items.map((item): QueueItem => {
      if (item.id !== change.id) return item;
      if (change.type === "confirm") return { ...item, status: "confirmed", snoozedUntil: undefined };
      if (change.type === "complete") return { ...item, status: "completed", snoozedUntil: undefined };
      if (!Number.isFinite(Date.parse(change.until))) throw new Error("Invalid snooze date");
      return { ...item, status: "snoozed", snoozedUntil: change.until };
    });
    if (!items.some((item, index) => item !== this.snapshot.items[index])) throw new Error(`Unknown queue item: ${change.id}`);
    return new AttentionQueue({ ...this.snapshot, items });
  }

  async openSource(id: string, opener: SourceOpener): Promise<void> {
    const item = this.snapshot.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Unknown queue item: ${id}`);
    assertUrl(item.sourceUrl);
    await opener.open(item.sourceUrl);
  }
}

export function syntheticOfflineSnapshot(now: Date): QueueSnapshot {
  return {
    generatedAt: now.toISOString(),
    permissionNotice: "Synthetic fixture only. Corporate source permissions are not configured.",
    offline: true,
    syncError: "Offline prototype: no approved network connector is configured.",
    items: [
      {
        id: "synthetic-review-14",
        title: "Review synthetic change #14",
        rationale: "A review is explicitly requested from the manager; deterministic rule review-requested.",
        sourceLabel: "synthetic/widgets#14",
        sourceUrl: "https://example.invalid/synthetic/widgets/pull/14",
        provenance: "Bundled synthetic PR fixture (no network access)",
        observedAt: "2026-10-08T08:00:00.000Z",
        dueAt: "2026-10-10T17:00:00.000Z",
        freshness: "stale",
        status: "proposed",
      },
      {
        id: "synthetic-ci-27",
        title: "Investigate synthetic CI failure #27",
        rationale: "CI has failed longer than the configured threshold; deterministic rule stale-ci.",
        sourceLabel: "synthetic/widgets#27",
        sourceUrl: "https://example.invalid/synthetic/widgets/pull/27",
        provenance: "Bundled synthetic PR fixture (no network access)",
        observedAt: "2026-10-07T12:00:00.000Z",
        freshness: "stale",
        status: "proposed",
      },
    ],
  };
}
