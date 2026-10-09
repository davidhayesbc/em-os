import assert from "node:assert/strict";
import test from "node:test";
import { findPrAttention } from "./attention";
import type { PullRequestRecord } from "./contracts";

const base: PullRequestRecord = {
  provider: "synthetic-git", repository: "acme/test", id: "1", title: "Test PR",
  url: "https://example.invalid/acme/test/pull/1", author: "Taylor Example", isDraft: false,
  reviewRequestedOfViewer: true, ciStatus: "failing", ciUpdatedAt: "2026-10-08T08:00:00.000Z",
  updatedAt: "2026-10-09T08:30:00.000Z",
};
const options = { now: new Date("2026-10-09T09:00:00.000Z"), staleCiHours: 24, staleDataHours: 6 };

test("finds review request and threshold-aged failing CI", () => {
  const items = findPrAttention([base], options);
  assert.deepEqual(items.map((item) => item.kind), ["review-requested", "stale-ci"]);
  assert.equal(items[0]?.freshness, "fresh");
  assert.equal(items[1]?.freshness, "stale");
  assert.equal(items[1]?.source.url, base.url);
});

test("suppresses drafts and CI younger than threshold", () => {
  assert.equal(findPrAttention([{ ...base, isDraft: true }], options).length, 0);
  const recent = { ...base, reviewRequestedOfViewer: false, ciUpdatedAt: "2026-10-09T08:00:00.000Z" };
  assert.equal(findPrAttention([recent], options).length, 0);
});

test("repeated evaluation is deterministic and does not mutate input", () => {
  const records = Object.freeze([Object.freeze({ ...base })]);
  assert.deepEqual(findPrAttention(records, options), findPrAttention(records, options));
});
