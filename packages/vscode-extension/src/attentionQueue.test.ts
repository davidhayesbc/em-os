import assert from "node:assert/strict";
import test from "node:test";
import { AttentionQueue, effectiveItemFreshness, isSnapshotStale, mergeQueueSnapshot, queueItemQuickPickLabel, syntheticOfflineSnapshot } from "./attentionQueue";

const now = new Date("2026-10-09T09:00:00.000Z");

test("offline snapshot never presents cached fixture as current", () => {
  const snapshot = syntheticOfflineSnapshot(now);
  assert.equal(snapshot.offline, true);
  assert.match(snapshot.syncError ?? "", /Offline prototype/);
  assert.ok(snapshot.items.every((item) => item.freshness === "stale"));
  assert.match(snapshot.permissionNotice, /not configured/);
});

test("a previously fresh snapshot expires instead of being presented as current", () => {
  const snapshot = syntheticOfflineSnapshot(now);
  const fresh = {
    ...snapshot,
    offline: false,
    syncError: undefined,
    generatedAt: "2026-10-09T07:00:00.000Z",
    items: snapshot.items.map((item) => ({ ...item, freshness: "fresh" as const })),
  };
  assert.equal(isSnapshotStale(fresh, now), true);
  assert.equal(effectiveItemFreshness(fresh, fresh.items[0]!, now), "stale");
  assert.equal(isSnapshotStale({ ...fresh, generatedAt: "2026-10-09T08:30:00.000Z" }, now), false);
});

test("command-palette labels mark stored-fresh items stale when their snapshot is stale", () => {
  const fixture = syntheticOfflineSnapshot(now);
  const item = { ...fixture.items[0]!, freshness: "fresh" as const };
  const current = {
    ...fixture,
    offline: false,
    syncError: undefined,
    generatedAt: "2026-10-09T08:30:00.000Z",
    items: [item],
  };

  assert.equal(queueItemQuickPickLabel(current, item, now), item.title);
  for (const snapshot of [
    { ...current, generatedAt: "2026-10-09T07:00:00.000Z" },
    { ...current, offline: true },
    { ...current, syncError: "Connector unavailable" },
  ]) {
    assert.equal(queueItemQuickPickLabel(snapshot, item, now), `$(warning) STALE: ${item.title}`);
  }
});

test("refresh preserves confirmed, completed, and snoozed action state", () => {
  const original = syntheticOfflineSnapshot(now);
  const extra = { ...original.items[0]!, id: "synthetic-completed", status: "proposed" as const };
  let queue = new AttentionQueue({ ...original, items: [...original.items, extra] });
  queue = queue.change({ type: "confirm", id: "synthetic-review-14" });
  queue = queue.change({ type: "snooze", id: "synthetic-ci-27", until: "2026-10-10T09:00:00.000Z" });
  queue = queue.change({ type: "complete", id: "synthetic-completed" });

  const refreshed = syntheticOfflineSnapshot(new Date("2026-10-09T10:00:00.000Z"));
  const merged = mergeQueueSnapshot(queue.snapshot, refreshed);
  assert.equal(merged.items.find((item) => item.id === "synthetic-review-14")?.status, "confirmed");
  assert.deepEqual(
    merged.items.find((item) => item.id === "synthetic-ci-27"),
    { ...refreshed.items[1], status: "snoozed", snoozedUntil: "2026-10-10T09:00:00.000Z" },
  );
  assert.equal(merged.items.find((item) => item.id === "synthetic-completed")?.status, "completed");
  assert.equal(new AttentionQueue(merged).visible(now).some((item) => item.id === "synthetic-completed"), false);
});

test("confirm, snooze, and complete update action state", () => {
  let queue = new AttentionQueue(syntheticOfflineSnapshot(now));
  queue = queue.change({ type: "confirm", id: "synthetic-review-14" });
  assert.equal(queue.snapshot.items[0]?.status, "confirmed");

  queue = queue.change({ type: "snooze", id: "synthetic-review-14", until: "2026-10-10T09:00:00.000Z" });
  assert.equal(queue.visible(now).some((item) => item.id === "synthetic-review-14"), false);
  assert.equal(queue.visible(new Date("2026-10-11T09:00:00.000Z")).some((item) => item.id === "synthetic-review-14"), true);

  queue = queue.change({ type: "complete", id: "synthetic-review-14" });
  assert.equal(queue.snapshot.items[0]?.status, "completed");
  assert.equal(queue.visible(new Date("2026-10-11T09:00:00.000Z")).some((item) => item.id === "synthetic-review-14"), false);
});

test("source-link smoke opens the exact validated URL", async () => {
  const queue = new AttentionQueue(syntheticOfflineSnapshot(now));
  const opened: string[] = [];
  await queue.openSource("synthetic-ci-27", { open: async (url) => { opened.push(url); } });
  assert.deepEqual(opened, ["https://example.invalid/synthetic/widgets/pull/27"]);
});
