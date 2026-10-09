import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SlackReviewQueueAdapter, type SlackPageSource, type SlackScope } from "./slack-connector.js";
import { SqliteStorage } from "./storage.js";

interface SlackFixture { pages: unknown[]; }
const baseScope: SlackScope = {
  channelIds: ["CPUBLIC1"],
  windowStart: "2026-10-01T00:00:00.000Z",
  windowEnd: "2026-10-10T00:00:00.000Z",
  grantedScopes: ["channels:history"],
  classification: "confidential",
  retentionDays: 30,
  maxExcerptChars: 120,
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "em-os-slack-"));
  const store = new SqliteStorage(join(dir, "store.sqlite"));
  await store.initialize();
  const parsed = JSON.parse(await readFile(join(process.cwd(), "fixtures/connectors/slack-pages.synthetic.json"), "utf8")) as SlackFixture;
  return { dir, store, pages: parsed.pages, cleanup: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

class FixtureSource implements SlackPageSource {
  calls = 0;
  constructor(readonly pages: unknown[], readonly transientFailures = 0) {}
  async fetchPage(cursor: string | undefined, request: Readonly<{channelIds: readonly string[]; oldest: string; latest: string; limit: number}>): Promise<unknown> {
    assert.deepEqual(request.channelIds, ["CPUBLIC1"]);
    assert.equal(request.limit, 200);
    this.calls++;
    if (this.calls <= this.transientFailures) throw new Error("synthetic 429");
    const expected = cursor === undefined ? 0 : cursor === "page-2" ? 1 : 2;
    return this.pages[expected];
  }
}

async function expectRejectedPage(page: unknown, scope = baseScope, pattern: RegExp) {
  const x = await fixture();
  try {
    await assert.rejects(() => new SlackReviewQueueAdapter(new FixtureSource([page]), x.store).sync(scope), pattern);
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n, 0);
  } finally { await x.cleanup(); }
}

test("paginates, retries, deduplicates updates, applies deletion, classification and retention", async () => {
  const x = await fixture();
  try {
    const source = new FixtureSource(x.pages, 1);
    const result = await new SlackReviewQueueAdapter(source, x.store, 2).sync(baseScope);
    assert.deepEqual(result, { pages: 3, fetched: 4, persisted: 3, deleted: 1, proposed: 3, cursor: "2026-10-09T09:10:00.000Z" });
    assert.equal(source.calls, 4);
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n, 2);
    const action = x.store.db.prepare("SELECT description,review_state FROM review_queue_proposals WHERE kind='action'").get() as {description:string;review_state:string};
    assert.equal(action.description, "Please prepare the revised synthetic launch checklist.");
    assert.equal(action.review_state, "proposed");
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_queue_proposals WHERE kind='decision'").get() as {n:number}).n, 0);
    const deleted = x.store.db.prepare("SELECT excerpt,deleted_at,classification,retention_until FROM source_records WHERE source_id='CPUBLIC1:1700000000.002'").get() as Record<string,unknown>;
    assert.equal(deleted.excerpt, null);
    assert.equal(deleted.classification, "confidential");
    assert.equal(deleted.retention_until, "2026-11-08T09:00:00.000Z");
    assert.equal((x.store.db.prepare("SELECT reason FROM deletion_tombstones WHERE source_id='CPUBLIC1:1700000000.002'").get() as {reason:string}).reason, "source_deleted");
  } finally { await x.cleanup(); }
});

test("prompt injection remains inert bounded source data and never auto-approves", async () => {
  const x = await fixture();
  try {
    const first = x.pages[0] as Record<string, unknown>;
    const singlePage = { ...first, nextCursor: undefined };
    await new SlackReviewQueueAdapter(new FixtureSource([singlePage]), x.store).sync({ ...baseScope, maxExcerptChars: 80 });
    const row = x.store.db.prepare("SELECT description,review_state FROM review_queue_proposals WHERE kind='action'").get() as {description:string;review_state:string};
    assert.match(row.description, /Ignore all previous policies/);
    assert.equal(row.description.length, 80);
    assert.equal(row.review_state, "proposed");
    x.store.transitionSlackProposal("slack:proposal:CPUBLIC1:1700000000.001", "approved", "manager", "confirmed synthetic action", "2026-10-09T10:00:00.000Z");
    assert.equal((x.store.db.prepare("SELECT review_state FROM review_queue_proposals WHERE kind='action'").get() as {review_state:string}).review_state, "approved");
    assert.throws(() => x.store.transitionSlackProposal("slack:proposal:CPUBLIC1:1700000000.001", "rejected", "manager", "changed", "2026-10-09T11:00:00.000Z"), /terminal review state/);
  } finally { await x.cleanup(); }
});

test("fails closed for excessive, write, private and non-allowlisted scope", async () => {
  const x = await fixture();
  try {
    await assert.rejects(() => new SlackReviewQueueAdapter(new FixtureSource(x.pages), x.store).sync({ ...baseScope, grantedScopes: ["channels:history", "chat:write"] }), /exact channels:history/);
    await assert.rejects(() => new SlackReviewQueueAdapter(new FixtureSource(x.pages), x.store).sync({ ...baseScope, grantedScopes: ["groups:history"] }), /exact channels:history/);
    await assert.rejects(() => new SlackReviewQueueAdapter(new FixtureSource(x.pages), x.store).sync({ ...baseScope, channelIds: [] }), /allowlist/);
  } finally { await x.cleanup(); }
  const basePage = x.pages[0] as {messages: Record<string,unknown>[]};
  await expectRejectedPage({ ...(x.pages[0] as object), messages: [{ ...basePage.messages[0], channelKind: "im" }] }, baseScope, /private channels and DMs/);
  await expectRejectedPage({ ...(x.pages[0] as object), messages: [{ ...basePage.messages[0], channelId: "COTHER1" }] }, baseScope, /non-allowlisted/);
});

test("rejects out-of-window and unbounded or unsupported response fields", async () => {
  const x = await fixture();
  try {
    const basePage = x.pages[0] as {messages: Record<string,unknown>[]};
    await expectRejectedPage({ ...(x.pages[0] as object), messages: [{ ...basePage.messages[0], occurredAt: "2026-11-01T00:00:00.000Z" }] }, baseScope, /outside the approved time window/);
    await expectRejectedPage({ ...(x.pages[0] as object), messages: [{ ...basePage.messages[0], token: "must-not-pass" }] }, baseScope, /unsupported fields/);
    await expectRejectedPage({ ...(x.pages[0] as object), messages: [{ ...basePage.messages[0], text: "x".repeat(12_001) }] }, baseScope, /exceeds 12000/);
  } finally { await x.cleanup(); }
});

test("page persistence and cursor are transactional", async () => {
  const x = await fixture();
  try {
    x.store.persistSlackPage({ connector: "slack-public-review-queue", scope: "CPUBLIC1", cursor: "good", observedAt: "2026-10-09T09:00:00.000Z", records: [], deletedSourceIds: [], proposals: [] });
    assert.throws(() => x.store.persistSlackPage({ connector: "slack-public-review-queue", scope: "CPUBLIC1", cursor: "bad", observedAt: "2026-10-09T09:05:00.000Z", records: [], deletedSourceIds: [], proposals: [{ id: "broken", kind: "action", description: "broken", sourceRecordId: "missing" }] }), /FOREIGN KEY/);
    assert.equal(x.store.getCursor("slack-public-review-queue", "CPUBLIC1"), "good");
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_queue_proposals").get() as {n:number}).n, 0);
  } finally { await x.cleanup(); }
});

test("exhausted retries preserve cursor and expose a sanitized connector error", async () => {
  const x = await fixture();
  try {
    x.store.persistSlackPage({ connector: "slack-public-review-queue", scope: "CPUBLIC1", cursor: "page-2", observedAt: "2026-10-09T09:00:00.000Z", records: [], deletedSourceIds: [], proposals: [] });
    await assert.rejects(() => new SlackReviewQueueAdapter(new FixtureSource(x.pages, 5), x.store, 1).sync(baseScope), /synthetic 429/);
    assert.equal(x.store.getCursor("slack-public-review-queue", "CPUBLIC1"), "page-2");
    assert.equal((x.store.db.prepare("SELECT last_error FROM sync_cursors WHERE connector='slack-public-review-queue'").get() as {last_error:string}).last_error, "synthetic 429");
  } finally { await x.cleanup(); }
});
