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
    assert.equal(result.cursor, undefined);
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records WHERE provider='meeting-notes' AND deleted_at IS NULL").get() as {n:number}).n, 2);
    const action = x.store.db.prepare("SELECT description,review_state FROM review_queue_proposals WHERE kind='action'").get() as {description:string;review_state:string};
    assert.equal(action.review_state, "proposed");
    assert.match(action.description, /revised synthetic launch checklist/);
    const redacted = x.store.db.prepare("SELECT description FROM review_queue_proposals WHERE description LIKE '%Confirm with%'").get() as {description:string};
    assert.doesNotMatch(redacted.description, /person@example\.invalid/);
    assert.doesNotMatch(redacted.description, /hunter2xyz123/);
    assert.match(redacted.description, /\[REDACTED-EMAIL\]/);
    assert.match(redacted.description, /\[REDACTED-SECRET\]/);
    const classifications = x.store.db.prepare("SELECT DISTINCT classification FROM source_records WHERE provider='meeting-notes' AND deleted_at IS NULL").all() as {classification:string}[];
    assert.deepEqual(classifications.map((r) => r.classification).sort(), ["confidential"]);
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
    assert.equal(await store.getCursor("meeting-notes", "notes/team.md"), undefined);
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_queue_proposals p INNER JOIN source_records s ON s.id=p.source_record_id WHERE s.provider='meeting-notes'").get() as {n:number}).n, 2);
    assert.equal((x.store.db.prepare("SELECT count(*) n FROM deletion_tombstones WHERE provider='meeting-notes'").get() as {n:number}).n, 1);
    const source = x.store.db.prepare("SELECT id,source_id,stable_url,excerpt,classification FROM source_records WHERE provider='meeting-notes' ORDER BY source_id").all() as {id:string;source_id:string;stable_url:string;excerpt:string|null;classification:string}[];
    assert.ok(source.every((row) => !row.stable_url.startsWith("file://") && !row.stable_url.includes("/tmp/")));
    assert.ok(source.every((row) => row.source_id.startsWith("76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847:")));
    assert.ok(source.every((row) => row.classification === "confidential"));
  } finally { await x.cleanup(); }
});

test("terminal page explicitly clears a pre-existing SQLite cursor", async () => {
  const x = await fixture();
  try {
    const store = new SqliteReviewQueueStore(x.store);
    await store.commit({
      connector: "meeting-notes",
      scope: baseScope.documentLabel,
      nextCursor: "resume-from-here",
      cursorUpdate: { kind: "set", value: "resume-from-here" },
      observedAt: "2026-10-09T08:00:00.000Z",
      fetched: 0,
      proposals: [],
      deletions: [],
    });
    assert.equal(await store.getCursor("meeting-notes", baseScope.documentLabel), "resume-from-here");

    const requested: (string | undefined)[] = [];
    const source: MeetingNotePageSource = {
      async fetchPage(cursor) {
        requested.push(cursor);
        return {
          schemaVersion: 1,
          documentId: "76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847",
          documentLabel: baseScope.documentLabel,
          cursor,
          observedAt: "2026-10-09T09:00:00.000Z",
          items: [],
        };
      },
    };
    const adapter = new MeetingNoteReviewQueueAdapter(source, store);
    await adapter.sync(baseScope);
    assert.equal(requested[0], "resume-from-here");
    assert.equal(await store.getCursor("meeting-notes", baseScope.documentLabel), undefined);

    await adapter.sync(baseScope);
    assert.equal(requested[1], undefined);
  } finally { await x.cleanup(); }
});

test("retention deadline is computed from observedAt and scope classification is persisted", async () => {
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
  assert.equal(proposal.classification, "confidential");
});

test("unquoted secret assignment is redacted before persistence", async () => {
  const x = await fixture();
  try {
    const page = {
      schemaVersion: 1,
      documentId: "76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847",
      documentLabel: "notes/team.md",
      observedAt: "2026-10-09T09:00:00.000Z",
      items: [
        { id: "mn-u", title: "Rotate deploy key password=hunter2xyz", body: "api_key=abcdef123456", occurredAt: "2026-10-08T10:00:00.000Z", proposalKind: "action" },
      ],
    };
    const source: MeetingNotePageSource = { async fetchPage() { return page; } };
    await new MeetingNoteReviewQueueAdapter(source, new SqliteReviewQueueStore(x.store)).sync(baseScope);
    const record = x.store.db.prepare("SELECT excerpt FROM source_records WHERE source_id LIKE '%:mn-u'").get() as {excerpt:string};
    assert.doesNotMatch(record.excerpt, /hunter2xyz/);
    assert.doesNotMatch(record.excerpt, /abcdef123456/);
    const proposal = x.store.db.prepare("SELECT description FROM review_queue_proposals WHERE source_record_id LIKE '%:mn-u'").get() as {description:string};
    assert.doesNotMatch(proposal.description, /hunter2xyz/);
  } finally { await x.cleanup(); }
});

test("pagination bounds fail closed and commit nothing", async () => {
  const store = new InMemoryReviewQueueStore();
  let pages = 0;
  const source: MeetingNotePageSource = {
    async fetchPage(cursor) {
      pages += 1;
      const next = `page-${pages + 1}`;
      return {
        schemaVersion: 1,
        documentId: "76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847",
        documentLabel: "notes/team.md",
        cursor,
        nextCursor: next,
        observedAt: "2026-10-09T09:00:00.000Z",
        items: [{ id: `mn-${pages}`, title: `Page ${pages}`, occurredAt: "2026-10-08T10:00:00.000Z", proposalKind: "action" }],
      };
    },
  };
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(source, store, 100).sync(baseScope), /exceeded maxPages=100/);
  assert.equal(store.proposals.size, 0);
  assert.equal(store.deletions.length, 0);
});

test("invalid injected pagination caps fail closed before reads and preserve queue state", async () => {
  const invalidCaps: ReadonlyArray<readonly [number, number, RegExp]> = [
    [Number.POSITIVE_INFINITY, 20_000, /maxPages must be an integer between 1 and 100/],
    [0, 20_000, /maxPages must be an integer between 1 and 100/],
    [-1, 20_000, /maxPages must be an integer between 1 and 100/],
    [1.5, 20_000, /maxPages must be an integer between 1 and 100/],
    [101, 20_000, /maxPages must be an integer between 1 and 100/],
    [100, Number.POSITIVE_INFINITY, /maxTotalItems must be an integer between 1 and 20000/],
    [100, 0, /maxTotalItems must be an integer between 1 and 20000/],
    [100, -1, /maxTotalItems must be an integer between 1 and 20000/],
    [100, 1.5, /maxTotalItems must be an integer between 1 and 20000/],
    [100, 20_001, /maxTotalItems must be an integer between 1 and 20000/],
  ];

  for (const [maxPages, maxTotalItems, pattern] of invalidCaps) {
    const store = new InMemoryReviewQueueStore();
    await store.commit({
      connector: "meeting-notes",
      scope: baseScope.documentLabel,
      cursorUpdate: { kind: "set", value: "existing-cursor" },
      observedAt: baseScope.windowStart,
      fetched: 0,
      proposals: [],
      deletions: [],
    });
    let fetchCalls = 0;
    const source: MeetingNotePageSource = { async fetchPage() { fetchCalls += 1; return {}; } };

    assert.throws(() => new MeetingNoteReviewQueueAdapter(source, store, maxPages, maxTotalItems), pattern);
    assert.equal(fetchCalls, 0);
    assert.equal(store.proposals.size, 0);
    assert.equal(store.deletions.length, 0);
    assert.equal(await store.getCursor("meeting-notes", baseScope.documentLabel), "existing-cursor");
  }
});

test("maximum injected pagination caps are accepted", async () => {
  const store = new InMemoryReviewQueueStore();
  let fetchCalls = 0;
  const source: MeetingNotePageSource = {
    async fetchPage() {
      fetchCalls += 1;
      return {
        schemaVersion: 1,
        documentId: "76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847",
        documentLabel: baseScope.documentLabel,
        observedAt: "2026-10-09T09:00:00.000Z",
        items: [],
      };
    },
  };

  await new MeetingNoteReviewQueueAdapter(source, store, 100, 20_000).sync(baseScope);
  assert.equal(fetchCalls, 1);
});

test("cumulative item cap fails closed and commits nothing", async () => {
  const store = new InMemoryReviewQueueStore();
  let pageIndex = 0;
  const source: MeetingNotePageSource = {
    async fetchPage(cursor) {
      pageIndex += 1;
      return {
        schemaVersion: 1,
        documentId: "76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847",
        documentLabel: "notes/team.md",
        cursor,
        nextCursor: `page-${pageIndex + 1}`,
        observedAt: "2026-10-09T09:00:00.000Z",
        items: Array.from({ length: 100 }, (_, i) => ({ id: `mn-${pageIndex}-${i}`, title: `Item ${pageIndex}-${i}`, occurredAt: "2026-10-08T10:00:00.000Z", proposalKind: "action" })),
      };
    },
  };
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(source, store, 100, 150).sync(baseScope), /exceeded maxTotalItems=150/);
  assert.equal(store.proposals.size, 0);
  assert.equal(store.deletions.length, 0);
});

test("second sync does not re-fetch the final page and does not rewrite the tombstone", async () => {
  const x = await fixture();
  try {
    const store = new SqliteReviewQueueStore(x.store);
    await new MeetingNoteReviewQueueAdapter(new FixtureSource(x.pages), store).sync(baseScope);
    const firstTombstone = x.store.db.prepare("SELECT content_hash FROM deletion_tombstones WHERE provider='meeting-notes'").get() as {content_hash:string};
    let requestedCursor: string | undefined = "initial";
    const emptySource: MeetingNotePageSource = {
      async fetchPage(cursor) {
        requestedCursor = cursor;
        return { schemaVersion: 1, documentId: "76c400ed6824c5561fd1eea689c07f6343f36c5a9fc81861cdd5ac87215ac847", documentLabel: "notes/team.md", observedAt: "2026-10-09T09:15:00.000Z", items: [] };
      },
    };
    const second = await new MeetingNoteReviewQueueAdapter(emptySource, store).sync(baseScope);
    assert.equal(second.fetched, 0);
    assert.equal(second.proposed, 0);
    assert.equal(second.deleted, 0);
    assert.equal(requestedCursor, undefined);
    const tombstones = x.store.db.prepare("SELECT content_hash,deleted_at FROM deletion_tombstones WHERE provider='meeting-notes'").all() as {content_hash:string;deleted_at:string}[];
    assert.equal(tombstones.length, 1);
    assert.equal(tombstones[0].content_hash, firstTombstone.content_hash);
  } finally { await x.cleanup(); }
});

test("schemaVersion mismatch fails closed", async () => {
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  page.schemaVersion = 2;
  await expectRejectedPage(page, baseScope, /unsupported meeting note page schema/);
});

test("page exceeding 200 items fails closed", async () => {
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  page.items = Array.from({ length: 201 }, (_, i) => ({ id: `mn-${i}`, title: "x", occurredAt: "2026-10-08T10:00:00.000Z" }));
  await expectRejectedPage(page, baseScope, /at most 200 items/);
});

test("title or body exceeding configured caps fails closed", async () => {
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  (page.items as Record<string, unknown>[])[0].title = "x".repeat(201);
  await expectRejectedPage(page, { ...baseScope, maxTitleChars: 200 }, /item.title is invalid or exceeds 200/);

  const page2 = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  (page2.items as Record<string, unknown>[])[0].body = "x".repeat(1001);
  await expectRejectedPage(page2, { ...baseScope, maxBodyChars: 1000 }, /item.body is invalid or exceeds 1000/);
});

test("page-level unknown fields fail closed", async () => {
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  page.extra = "must-not-pass";
  await expectRejectedPage(page, baseScope, /unsupported fields/);
});

test("page cursor echo mismatch fails closed", async () => {
  const data = JSON.parse(await readFile(join(process.cwd(), "fixtures/connectors/meeting-notes.synthetic.json"), "utf8")) as MeetingFixture;
  const page = JSON.parse(JSON.stringify(data.pages[1])) as Record<string, unknown>;
  page.cursor = "wrong-cursor";
  await expectRejectedPage(page, baseScope, /cursor does not match/);
});

test("wrapped fetch error preserves cause and commits nothing", async () => {
  const store = new InMemoryReviewQueueStore();
  const source: MeetingNotePageSource = {
    async fetchPage() { throw new Error("network partition"); },
  };
  await assert.rejects(() => new MeetingNoteReviewQueueAdapter(source, store).sync(baseScope), /meeting note read failed: network partition/);
  assert.equal(store.proposals.size, 0);
});

test("non-boolean deleted fails closed", async () => {
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  (page.items as Record<string, unknown>[])[0].deleted = "true";
  await expectRejectedPage(page, baseScope, /item.deleted must be boolean/);
});

test("invalid proposalKind fails closed", async () => {
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  (page.items as Record<string, unknown>[])[0].proposalKind = "question";
  await expectRejectedPage(page, baseScope, /unsupported proposal kind/);
});

test("offset-bearing timestamps fail closed", async () => {
  const page = JSON.parse(JSON.stringify((await fixture()).pages[0])) as Record<string, unknown>;
  (page.items as Record<string, unknown>[])[0].occurredAt = "2026-10-08T10:00:00+02:00";
  await expectRejectedPage(page, baseScope, /must be UTC ISO-8601/);
});
