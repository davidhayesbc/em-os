import assert from "node:assert/strict";
import test from "node:test";
import { AttentionQueue, isSnapshotStale, syntheticOfflineSnapshot } from "./attentionQueue";

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
  assert.equal(isSnapshotStale({ ...fresh, generatedAt: "2026-10-09T08:30:00.000Z" }, now), false);
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
