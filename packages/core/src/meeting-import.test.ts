import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MeetingNoteReviewQueueAdapter,
  type MeetingNotePageSource,
  type MeetingNoteScope,
} from "./meeting-import.js";
import { InMemoryReviewQueueStore, SqliteReviewQueueStore } from "./review-adapters.js";
import { SqliteStorage } from "./storage.js";

interface MeetingFixture { pages: unknown[]; }

const approvedRoot = "/tmp/meeting-notes-root";
const baseScope: MeetingNoteScope = {
  approvedRoot,
  allowedLabels: ["notes/team.md"],
  documentLabel: "notes/team.md",
  windowStart: "2026-10-01T00:00:00.000Z",
  windowEnd: "2026-10-10T00:00:00.000Z",
  classification: "confidential",
  retentionDays: 30,
  maxTitleChars: 200,
  maxBodyChars: 1000,
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "em-os-meeting-"));
  const store = new SqliteStorage(join(dir, "store.sqlite"));
  await store.initialize();
  const parsed = JSON.parse(await readFile(join(process.cwd(), "fixtures/connectors/meeting-notes.synthetic.json"), "utf8")) as MeetingFixture;
  return { dir, store, pages: parsed.pages, cleanup: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

class FixtureSource implements MeetingNotePageSource {
  calls = 0;
  constructor(readonly pages: unknown[]) {}
  async fetchPage(cursor: string | undefined, request: Readonly<{ documentId: string; documentLabel: string; windowStart: string; windowEnd: string; limit: number }>): Promise<unknown> {
    assert.equal(request.documentLabel, "notes/team.md");
    assert.equal(request.limit, 200);
    assert.equal(request.windowStart, baseScope.windowStart);
    assert.equal(request.windowEnd, baseScope.windowEnd);
    this.calls++;
    const expected = cursor === undefined ? 0 : cursor === "page-2" ? 1 : 2;
    return this.pages[expected];
  }
}

async function expectRejectedPage(page: unknown, scope = baseScope, pattern: RegExp) {
  const x = await fixture();
  try {
    await assert.rejects(() => new MeetingNoteReviewQueueAdapter(new FixtureSource([page]), new SqliteReviewQueueStore(x.store)).sync(scope), pattern);
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records WHERE provider='meeting-notes'").get() as {n:number}).n, 0);
  } finally { await x.cleanup(); }
}

test("paginates, deduplicates updates, applies deletion, classification, retention and redaction", async () => {
  const x = await fixture();
  try {
    const result = await new MeetingNoteReviewQueueAdapter(new FixtureSource(x.pages), new SqliteReviewQueueStore(x.store)).sync(baseScope);
    assert.equal(result.status, "synced");
    assert.equal(result.fetched, 5);
    assert.equal(result.proposed, 4);
    assert.equal(result.deleted, 1);
    assert.equal(result.cursor, "page-3");
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records WHERE provider='meeting-notes' AND deleted_at IS NULL").get() as {n:number}).n, 2);
    const action = x.store.db.prepare("SELECT description,review_state FROM review_queue_proposals WHERE kind='action'").get() as {description:string;review_state:string};
    assert.equal(action.review_state, "proposed");
    assert.match(action.description, /revised synthetic launch checklist/);
    const redacted = x.store.db.prepare("SELECT description FROM review_queue_proposals WHERE description LIKE '%Confirm with%'").get() as {description:string};
    assert.doesNotMatch(redacted.description, /person@example\.invalid/);
    assert.doesNotMatch(redacted.description, /synthetic-test/);
    assert.match(redacted.description, /\[REDACTED-EMAIL\]/);
    assert.match(redacted.description, /\[REDACTED-SECRET\]/);
    const deleted = x.store.db.prepare("SELECT deleted_at,deletion_reason FROM source_records WHERE source_id LIKE '%:mn-2'").get() as {deleted_at:string|null;deletion_reason:string|null};
    assert.ok(deleted.deleted_at);
    assert.equal(deleted.deletion_reason, "source_deleted");
  } finally { await x.cleanup(); }
});

test("provenance stores hashed document id and relative label, never an absolute local path", async () => {
  const store = new InMemoryReviewQueueStore();
  const data = JSON.parse(await readFile(join(process.cwd(), "fixtures/connectors/meeting-notes.synthetic.json"), "utf8")) as MeetingFixture;
  const singlePage = { ...(data.pages[0] as object), nextCursor: undefined, items: [(data.pages[0] as {items: Record<string,unknown>[]}).items[0]] };
  const source: MeetingNotePageSource = { async fetchPage() { return singlePage; } };
  await new MeetingNoteReviewQueueAdapter(source, store).sync(baseScope);
  const proposal = [...store.proposals.values()][0];
  assert.equal(proposal.provider, "meeting-notes");
  assert.match(proposal.sourceId, /^[a-f0-9]{64}:mn-/);
  assert.equal(proposal.scope, "notes/team.md");
  assert.equal(proposal.sourceUrl, "https://example.invalid/meeting-notes/notes%2Fteam.md");
  assert.doesNotMatch(JSON.stringify(store.proposals), /\/tmp\/meeting-notes-root/);
  assert.doesNotMatch(JSON.stringify(store.proposals), /file:\/\//);
});

test("fails closed for disallowed labels, traversal, non-absolute root, invalid classification and unsupported DTO fields", async () => {
  const store = new InMemoryReviewQueueStore();
  const source: MeetingNotePageSource = { async fetchPage() { return {}; } };
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(source, store).sync({ ...baseScope, documentLabel: "notes/other.md" }), /not in the allowed labels list/);
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(source, store).sync({ ...baseScope, documentLabel: "../etc/passwd" }), /relative path without traversal/);
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(source, store).sync({ ...baseScope, approvedRoot: "relative/path" }), /must be an absolute path/);
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(source, store).sync({ ...baseScope, classification: "public" as MeetingNoteScope["classification"] }), /unsupported content classification/);
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  (page.items as Record<string, unknown>[])[0].token = "must-not-pass";
  await expectRejectedPage(page, baseScope, /unsupported fields/);
});

test("document id and label mismatch and repeated cursor fail closed", async () => {
  const data = JSON.parse(await readFile(join(process.cwd(), "fixtures/connectors/meeting-notes.synthetic.json"), "utf8")) as MeetingFixture;
  const page = JSON.parse(JSON.stringify(data.pages[0])) as Record<string, unknown>;
  const originalDocumentId = String(page.documentId);
  page.documentId = "0000000000000000000000000000000000000000000000000000000000000000";
  await expectRejectedPage(page, baseScope, /document id does not match/);

  const loopSource: MeetingNotePageSource = {
    async fetchPage(cursor) {
      if (cursor === undefined) return { schemaVersion: 1, documentId: originalDocumentId, documentLabel: "notes/team.md", nextCursor: "page-2", observedAt: "2026-10-09T09:00:00.000Z", items: [] };
      return { schemaVersion: 1, documentId: originalDocumentId, documentLabel: "notes/team.md", cursor: "page-2", nextCursor: "page-2", observedAt: "2026-10-09T09:05:00.000Z", items: [] };
    },
  };
  const store = new InMemoryReviewQueueStore();
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(loopSource, store).sync({ ...baseScope, windowEnd: "2026-10-09T09:00:00.000Z" }), /pagination cursor repeated/);
});

test("SqliteReviewQueueStore persists meeting-note proposals, cursor and tombstones transactionally", async () => {
  const x = await fixture();
  try {
    const store = new SqliteReviewQueueStore(x.store);
    await new MeetingNoteReviewQueueAdapter(new FixtureSource(x.pages), store).sync(baseScope);
    assert.equal(await store.getCursor("meeting-notes", "notes/team.md"), "page-3");
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_queue_proposals p INNER JOIN source_records s ON s.id=p.source_record_id WHERE s.provider='meeting-notes'").get() as {n:number}).n, 2);
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM deletion_tombstones WHERE provider='meeting-notes'").get() as {n:number}).n, 1);
    const source = x.store.db.prepare("SELECT id,source_id,stable_url,excerpt FROM source_records WHERE provider='meeting-notes' ORDER BY source_id").all() as {id:string;source_id:string;stable_url:string;excerpt:string|null}[];
    assert.ok(source.every((row) => !row.stable_url.startsWith("file://") && !row.stable_url.includes("/tmp/")));
    assert.ok(source.every((row) => row.source_id.startsWith("76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847:")));
  } finally { await x.cleanup(); }
});

test("retention deadline is computed from observedAt and classification is preserved", async () => {
  const store = new InMemoryReviewQueueStore();
  const page = {
    schemaVersion: 1,
    documentId: "76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847",
    documentLabel: "notes/team.md",
    observedAt: "2026-10-09T09:00:00.000Z",
    items: [
      { id: "mn-r", title: "Retention check", occurredAt: "2026-10-08T10:00:00.000Z", proposalKind: "action" },
    ],
  };
  const source: MeetingNotePageSource = { async fetchPage() { return page; } };
  await new MeetingNoteReviewQueueAdapter(source, store).sync(baseScope);
  const proposal = [...store.proposals.values()][0];
  assert.equal(proposal.retentionUntil, "2026-11-08T09:00:00.000Z");
});
