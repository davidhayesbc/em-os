import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ATTENTION_POLICY, rankAttention, recordAttentionFeedback } from "./attention";
import type { AttentionFeedback, AttentionPolicy, AttentionWorkItem } from "./contracts";

const now = new Date("2026-11-01T06:30:00.000Z"); // US DST fallback day
const policy: AttentionPolicy = structuredClone(DEFAULT_ATTENTION_POLICY);
const base: AttentionWorkItem = {
  id: "action:1", kind: "action", title: "Ship committed work", source: { label: "fixture#1", url: "https://example.invalid/1" },
  observedAt: "2026-11-01T05:30:00.000Z", initiativeId: "initiative:1", confidence: 1,
};
const event = (overrides: Partial<AttentionFeedback>): AttentionFeedback => ({
  itemId: base.id, action: "pin", reason: "manager decision", at: "2026-11-01T06:00:00.000Z", ...overrides,
});

test("review request and threshold-aged stale CI receive explicit components", () => {
  const item = { ...base, id: "pr:1", kind: "pull-request" as const, reviewRequested: true, ciStatus: "failing" as const,
    ciUpdatedAt: "2026-10-31T06:30:00.000Z" };
  const [ranked] = rankAttention([item], policy, now);
  assert.deepEqual(ranked?.ruleIds.filter((id) => id.startsWith("pr.")), ["pr.review-requested", "pr.stale-ci"]);
  assert.match(ranked?.reason ?? "", /review is requested/i);
});

test("stale CI threshold is configurable and exact", () => {
  const item = { ...base, ciStatus: "failing" as const, ciUpdatedAt: "2026-10-31T06:30:00.000Z", explicitPriority: 1 };
  assert.ok(rankAttention([item], policy, now)[0]?.ruleIds.includes("pr.stale-ci"));
  assert.ok(!rankAttention([item], { ...policy, staleCiHours: 25 }, now)[0]?.ruleIds.includes("pr.stale-ci"));
});

test("timezone offsets handle the repeated DST hour as absolute instants", () => {
  const item = { ...base, dueAt: "2026-11-01T01:15:00-05:00" }; // 15 minutes before now
  assert.ok(rankAttention([item], policy, now)[0]?.ruleIds.includes("due.overdue"));
  assert.throws(() => rankAttention([{ ...base, dueAt: "2026-11-01T01:15:00" }], policy, now), /timezone/);
});

test("stable ties use observed time then key independent of input order", () => {
  const a = { ...base, id: "a", explicitPriority: 1 };
  const b = { ...base, id: "b", explicitPriority: 1 };
  assert.deepEqual(rankAttention([b, a], policy, now).map((x) => x.key), ["a", "b"]);
});

test("offset-equivalent observed instants fall through to the stable key", () => {
  const z = { ...base, id: "z", observedAt: "2026-11-01T01:00:00-05:00", explicitPriority: 1 };
  const a = { ...base, id: "a", observedAt: "2026-11-01T06:00:00Z", explicitPriority: 1 };
  assert.deepEqual(rankAttention([z, a], policy, now).map((x) => x.key), ["a", "z"]);
});

test("dismiss, active snooze, score threshold, and per-kind cap suppress items", () => {
  const items = [{ ...base, id: "a", explicitPriority: 2 }, { ...base, id: "b", explicitPriority: 1 }, { ...base, id: "c" }];
  const feedback = [event({ itemId: "a", action: "dismiss" }), event({ itemId: "b", action: "snooze", until: "2026-11-01T07:00:00Z" })];
  assert.deepEqual(rankAttention(items, { ...policy, maxPerKind: 1, minimumScore: 10 }, now, feedback), []);
  assert.deepEqual(rankAttention(items, { ...policy, maxPerKind: 1 }, now).map((x) => x.key), ["a"]);
});

test("stale and fresh banners are explicit", () => {
  const stale = { ...base, id: "stale", observedAt: "2026-10-31T00:00:00Z", explicitPriority: 1 };
  const fresh = { ...base, id: "fresh", explicitPriority: 1 };
  const ranked = rankAttention([stale, fresh], policy, now);
  assert.match(ranked.find((x) => x.key === "stale")?.banner ?? "", /^Stale data:/);
  assert.match(ranked.find((x) => x.key === "fresh")?.banner ?? "", /^Fresh data:/);
});

test("feedback is append-only, requires reason, supports pin and correction", () => {
  const original: readonly AttentionFeedback[] = Object.freeze([]);
  const history = recordAttentionFeedback(original, event({ action: "correct", correction: { blockerSeverity: "critical" } }));
  const pinned = recordAttentionFeedback(history, event({ action: "pin" }));
  assert.equal(original.length, 0);
  assert.equal(rankAttention([base], policy, now, pinned)[0]?.pinned, true);
  assert.ok(rankAttention([base], policy, now, pinned)[0]?.ruleIds.includes("blocker.critical"));
  assert.throws(() => recordAttentionFeedback([], event({ reason: "" })), /reason/);
  assert.throws(() => recordAttentionFeedback([], event({ action: "correct", correction: {} })), /corrected field/);
});

test("future corrections remain in the audit log but do not affect an earlier ranking snapshot", () => {
  const future = event({ action: "correct", at: "2026-11-01T07:00:00Z", correction: { blockerSeverity: "critical" } });
  const history = recordAttentionFeedback([], future);
  const [ranked] = rankAttention([{ ...base, explicitPriority: 1 }], policy, now, history);
  assert.ok(!ranked?.ruleIds.includes("blocker.critical"));
  assert.equal(history.length, 1);
});

test("ambiguous identity and missing initiative show insufficient context without merging", () => {
  const ambiguous = { ...base, id: "identity:a", initiativeId: undefined, identityStatus: "ambiguous" as const, explicitPriority: 1 };
  const [ranked] = rankAttention([ambiguous], policy, now);
  assert.equal(ranked?.contextStatus, "ambiguous-identity");
  assert.match(ranked?.reason ?? "", /confirmation required/);
});

test("pin outranks score and score components contain only approved work factors", () => {
  const high = { ...base, id: "high", blockerSeverity: "critical" as const };
  const low = { ...base, id: "low" };
  const ranked = rankAttention([high, low], policy, now, [event({ itemId: "low" })]);
  assert.deepEqual(ranked.map((x) => x.key), ["low", "high"]);
  assert.ok(ranked.every((x) => x.ruleIds.every((id) => !/volume|person|productivity/.test(id))));
});
