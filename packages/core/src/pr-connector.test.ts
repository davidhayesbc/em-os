import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ConnectorError, parsePrPage, syncPullRequests,
  type ConnectorFailureKind, type NormalizedPullRequest, type PrPageRequest, type PrSyncCursor, type PrSyncStore, type ReadOnlyPrTransport,
} from "./pr-connector";

class MemoryStore implements PrSyncStore {
  cursor = new Map<string, PrSyncCursor>();
  records = new Map<string, NormalizedPullRequest>();
  failures: Array<{ kind: ConnectorFailureKind; message: string }> = [];
  failNextCommit = false;
  commits = 0;
  private key(connector: string, repository: string): string { return `${connector}:${repository}`; }
  async readCursor(connector: string, repository: string): Promise<PrSyncCursor | undefined> { return this.cursor.get(this.key(connector, repository)); }
  async commitPage(input: { connectorId: string; repository: string; records: readonly NormalizedPullRequest[]; deletedSourceIds: readonly string[]; cursor: PrSyncCursor }): Promise<void> {
    if (this.failNextCommit) { this.failNextCommit = false; throw new Error("synthetic persistence failure"); }
    const nextRecords = new Map(this.records);
    for (const record of input.records) nextRecords.set(record.id, record);
    for (const id of input.deletedSourceIds) nextRecords.delete(id);
    this.records = nextRecords;
    this.cursor.set(this.key(input.connectorId, input.repository), { ...input.cursor });
    this.commits += 1;
  }
  async recordFailure(input: { kind: ConnectorFailureKind; message: string }): Promise<void> { this.failures.push(input); }
  async clearFailure(): Promise<void> { this.failures = []; }
}

class PagesTransport implements ReadOnlyPrTransport {
  readonly route = "synthetic-fixture" as const;
  requests: PrPageRequest[] = [];
  attempts = 0;
  constructor(readonly pages: readonly unknown[], readonly failures: readonly ConnectorError[] = []) {}
  async fetchPage(request: PrPageRequest): Promise<unknown> {
    this.requests.push(request); this.attempts += 1;
    const failure = this.failures[this.attempts - 1];
    if (failure) throw failure;
    const index = request.cursor ? 1 : 0;
    const page = this.pages[index];
    if (!page) throw new Error("missing synthetic page");
    return page;
  }
}

async function fixturePages(): Promise<unknown[]> {
  const fixture = JSON.parse(await readFile("fixtures/connectors/pr-pages.synthetic.json", "utf8")) as { classification: string; pages: Record<string, unknown[]> };
  assert.equal(fixture.classification, "synthetic");
  return fixture.pages["acme/widget"] ?? [];
}

const config = { provider: "synthetic-git", repositories: ["acme/widget"], sourceOrigins: ["https://example.invalid"], scopes: ["pull_requests:read"], maxTransientRetries: 1 } as const;

test("paginates, deduplicates, reconciles updates and deletions", async () => {
  const transport = new PagesTransport(await fixturePages());
  const store = new MemoryStore();
  const results = await syncPullRequests(config, transport, store);
  assert.equal(results[0]?.status, "success");
  assert.equal(results[0]?.pages, 2);
  assert.equal(transport.requests[1]?.cursor, "page-2");
  assert.deepEqual(transport.requests[0]?.scopes, ["pull_requests:read"]);
  assert.equal(store.records.size, 1);
  assert.equal(store.records.get("101")?.title, "Synthetic updated record");
  assert.equal(store.records.get("101")?.state, "merged");
  assert.equal(store.records.has("102"), false);
  assert.deepEqual(store.cursor.get("pr:synthetic-git:acme/widget"), { watermark: "2026-10-09T08:30:00.000Z" });
});

test("does not advance cursor when persistence fails", async () => {
  const store = new MemoryStore(); store.failNextCommit = true;
  const result = await syncPullRequests(config, new PagesTransport(await fixturePages()), store);
  assert.equal(result[0]?.status, "error");
  assert.equal(store.cursor.size, 0);
  assert.equal(store.records.size, 0);
  assert.equal(store.failures[0]?.kind, "offline");
});

test("retries transient rate limits but not permission errors", async () => {
  const pages = await fixturePages();
  const retryTransport = new PagesTransport(pages, [new ConnectorError("rate-limit", "retry later", true)]);
  const retryResult = await syncPullRequests(config, retryTransport, new MemoryStore());
  assert.equal(retryResult[0]?.status, "success");
  assert.equal(retryResult[0]?.retries, 1);
  const deniedTransport = new PagesTransport(pages, [new ConnectorError("permission", "read scope denied", false)]);
  const deniedStore = new MemoryStore();
  const denied = await syncPullRequests(config, deniedTransport, deniedStore);
  assert.equal(denied[0]?.error?.kind, "permission");
  assert.equal(deniedTransport.attempts, 1);
  assert.equal(deniedStore.commits, 0);
});

test("rejects schema drift and preserves prior data", async () => {
  const pages = await fixturePages();
  const drifted = { ...(pages[0] as object), writeToken: "must-not-be-accepted" };
  const store = new MemoryStore();
  const result = await syncPullRequests(config, new PagesTransport([drifted]), store);
  assert.equal(result[0]?.error?.kind, "schema");
  assert.equal(store.commits, 0);
  assert.throws(() => parsePrPage({ schemaVersion: 2, observedAt: new Date().toISOString(), records: [] }, "acme/widget"), /schema version/);
});

test("accepts only allowlisted origins and canonical repository PR paths", async () => {
  const [fixture] = await fixturePages();
  assert.doesNotThrow(() => parsePrPage(fixture, "acme/widget", config.sourceOrigins));
  const withUrl = (url: string): unknown => {
    const page = structuredClone(fixture) as { records: Array<Record<string, unknown>> };
    page.records[0]!.url = url;
    return page;
  };
  assert.throws(
    () => parsePrPage(withUrl("https://attacker.invalid/not-acme/widget/pull/101"), "acme/widget", config.sourceOrigins),
    /origin is outside the configured allowlist/,
  );
  assert.throws(
    () => parsePrPage(withUrl("https://example.invalid/not-acme/widget/pull/101"), "acme/widget", config.sourceOrigins),
    /canonical \/owner\/repository\/pull\/source-id path/,
  );
  assert.throws(
    () => parsePrPage(withUrl("https://example.invalid/acme/widget/pull/999"), "acme/widget", config.sourceOrigins),
    /canonical \/owner\/repository\/pull\/source-id path/,
  );
});

test("fixture mode performs no network access", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
  try {
    const result = await syncPullRequests(config, new PagesTransport(await fixturePages()), new MemoryStore());
    assert.equal(result[0]?.status, "success");
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("fails closed for unapproved routes, scopes, and repositories", async () => {
  const pages = await fixturePages();
  await assert.rejects(
    syncPullRequests({ ...config, scopes: ["pull_requests:write"] }, new PagesTransport(pages), new MemoryStore()),
    /only approved scope/,
  );
  await assert.rejects(
    syncPullRequests({ ...config, repositories: ["not-a-repository"] }, new PagesTransport(pages), new MemoryStore()),
    /allowlist/,
  );
  await assert.rejects(
    syncPullRequests({ ...config, sourceOrigins: ["http://example.invalid"] }, new PagesTransport(pages), new MemoryStore()),
    /source origin allowlist/,
  );
  const transport = new PagesTransport(pages);
  (transport as unknown as { route: string }).route = "direct-mcp";
  await assert.rejects(syncPullRequests(config, transport as ReadOnlyPrTransport, new MemoryStore()), /unapproved PR ingress route/);
});

test("offline failures are visible and non-destructive", async () => {
  const store = new MemoryStore();
  const transport = new PagesTransport([], [new ConnectorError("offline", "network unavailable", true), new ConnectorError("offline", "network unavailable", true)]);
  const result = await syncPullRequests(config, transport, store);
  assert.deepEqual(result[0]?.error, { kind: "offline", message: "network unavailable", retryable: true });
  assert.equal(store.records.size, 0);
  assert.equal(store.cursor.size, 0);
  assert.equal(store.failures[0]?.kind, "offline");
});
