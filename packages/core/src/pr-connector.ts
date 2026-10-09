import type { CiStatus, PullRequestRecord } from "./contracts";

export const PR_CONNECTOR_SCHEMA_VERSION = 1 as const;
export const MAX_PAGE_SIZE = 50;
export const MAX_PAGES_PER_SYNC = 20;
export const PR_READ_SCOPE = "pull_requests:read" as const;

export type PullRequestState = "open" | "closed" | "merged";
export type ConnectorFailureKind = "permission" | "rate-limit" | "offline" | "schema" | "configuration" | "transient";

export interface PrConnectorConfig {
  provider: string;
  repositories: readonly string[];
  sourceOrigins: readonly string[];
  scopes: readonly string[];
  pageSize?: number;
  maxPages?: number;
  maxTransientRetries?: number;
}

export interface PrSyncCursor {
  cursor?: string;
  watermark?: string;
}

export interface NormalizedPullRequest extends PullRequestRecord {
  state: PullRequestState;
}

export interface PrPageChange {
  record?: NormalizedPullRequest;
  deletedSourceId?: string;
}

export interface PrPage {
  schemaVersion: 1;
  observedAt: string;
  changes: readonly PrPageChange[];
  nextCursor?: string;
  watermark?: string;
}

export interface PrPageRequest {
  repository: string;
  scopes: readonly [typeof PR_READ_SCOPE];
  limit: number;
  cursor?: string;
  updatedSince?: string;
}

export interface ReadOnlyPrTransport {
  readonly route: "synthetic-fixture" | "approved-claude-runner";
  fetchPage(request: Readonly<PrPageRequest>): Promise<unknown>;
}

export interface PrSyncStore {
  readCursor(connectorId: string, repository: string): Promise<PrSyncCursor | undefined>;
  /** Atomically reconciles this page and advances its cursor only if persistence commits. */
  commitPage(input: Readonly<{
    connectorId: string;
    repository: string;
    records: readonly NormalizedPullRequest[];
    deletedSourceIds: readonly string[];
    cursor: PrSyncCursor;
    observedAt: string;
  }>): Promise<void>;
  recordFailure(input: Readonly<{
    connectorId: string;
    repository: string;
    kind: ConnectorFailureKind;
    message: string;
    retryable: boolean;
    observedAt: string;
  }>): Promise<void>;
  clearFailure(connectorId: string, repository: string, observedAt: string): Promise<void>;
}

export interface PrSyncRepositoryResult {
  repository: string;
  status: "success" | "error";
  fetched: number;
  deleted: number;
  pages: number;
  retries: number;
  error?: { kind: ConnectorFailureKind; message: string; retryable: boolean };
}

export class ConnectorError extends Error {
  constructor(
    readonly kind: ConnectorFailureKind,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

const allowedPageKeys = new Set(["schemaVersion", "observedAt", "records", "deletedSourceIds", "nextCursor", "watermark"]);
const allowedRecordKeys = new Set([
  "sourceId", "url", "repository", "title", "author", "state", "isDraft", "reviewRequestedOfViewer",
  "ciStatus", "ciUpdatedAt", "updatedAt",
]);
const ciStatuses = new Set<CiStatus>(["passing", "failing", "pending", "unknown"]);
const states = new Set<PullRequestState>(["open", "closed", "merged"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ConnectorError("schema", `${label} must be an object`, false);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  if (extra) throw new ConnectorError("schema", `${label} contains unapproved field: ${extra}`, false);
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new ConnectorError("schema", `${label} must be 1-${max} characters`, false);
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | undefined {
  return value === undefined ? undefined : text(value, label, max);
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 40);
  if (!Number.isFinite(Date.parse(result))) throw new ConnectorError("schema", `${label} must be an RFC3339 timestamp`, false);
  return result;
}

function stableUrl(value: unknown, repository: string, sourceId: string, sourceOrigins: ReadonlySet<string>): string {
  const result = text(value, "record.url", 2048);
  let parsed: URL;
  try { parsed = new URL(result); } catch { throw new ConnectorError("schema", "record.url must be an absolute HTTPS URL", false); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.search) throw new ConnectorError("schema", "record.url must be a canonical HTTPS URL without credentials, query, or fragment", false);
  if (!sourceOrigins.has(parsed.origin)) throw new ConnectorError("schema", "record.url origin is outside the configured allowlist", false);
  const [owner, name] = repository.split("/");
  if (parsed.pathname !== `/${owner}/${name}/pull/${sourceId}`) {
    throw new ConnectorError("schema", "record.url must use the canonical /owner/repository/pull/source-id path", false);
  }
  return result;
}

export function parsePrPage(value: unknown, expectedRepository: string, sourceOrigins: readonly string[] = []): PrPage {
  const page = object(value, "page");
  exactKeys(page, allowedPageKeys, "page");
  if (page.schemaVersion !== PR_CONNECTOR_SCHEMA_VERSION) throw new ConnectorError("schema", "unsupported PR connector schema version", false);
  const observedAt = timestamp(page.observedAt, "page.observedAt");
  if (!Array.isArray(page.records) || page.records.length > MAX_PAGE_SIZE) throw new ConnectorError("schema", `page.records must contain at most ${MAX_PAGE_SIZE} records`, false);
  if (page.deletedSourceIds !== undefined && (!Array.isArray(page.deletedSourceIds) || page.deletedSourceIds.length > MAX_PAGE_SIZE)) {
    throw new ConnectorError("schema", `page.deletedSourceIds must contain at most ${MAX_PAGE_SIZE} IDs`, false);
  }
  const changes: PrPageChange[] = [];
  for (const raw of page.records) {
    const record = object(raw, "record");
    exactKeys(record, allowedRecordKeys, "record");
    const sourceId = text(record.sourceId, "record.sourceId", 200);
    const repository = text(record.repository, "record.repository", 200);
    if (repository !== expectedRepository) throw new ConnectorError("schema", "record repository is outside the requested allowlist entry", false);
    const state = text(record.state, "record.state", 10) as PullRequestState;
    if (!states.has(state)) throw new ConnectorError("schema", "record.state is invalid", false);
    const ciStatus = text(record.ciStatus, "record.ciStatus", 10) as CiStatus;
    if (!ciStatuses.has(ciStatus)) throw new ConnectorError("schema", "record.ciStatus is invalid", false);
    if (typeof record.isDraft !== "boolean" || typeof record.reviewRequestedOfViewer !== "boolean") throw new ConnectorError("schema", "record boolean fields are invalid", false);
    changes.push({ record: {
      provider: "", repository, id: sourceId, title: text(record.title, "record.title", 300),
      url: stableUrl(record.url, repository, sourceId, new Set(sourceOrigins)), author: text(record.author, "record.author", 200), state,
      isDraft: record.isDraft, reviewRequestedOfViewer: record.reviewRequestedOfViewer, ciStatus,
      ...(record.ciUpdatedAt === undefined ? {} : { ciUpdatedAt: timestamp(record.ciUpdatedAt, "record.ciUpdatedAt") }),
      updatedAt: timestamp(record.updatedAt, "record.updatedAt"),
    } });
  }
  if (Array.isArray(page.deletedSourceIds)) {
    for (const id of page.deletedSourceIds) changes.push({ deletedSourceId: text(id, "deletedSourceId", 200) });
  }
  return {
    schemaVersion: 1, observedAt, changes,
    ...(page.nextCursor === undefined ? {} : { nextCursor: optionalText(page.nextCursor, "page.nextCursor", 512) }),
    ...(page.watermark === undefined ? {} : { watermark: timestamp(page.watermark, "page.watermark") }),
  };
}

function deduplicate(changes: readonly PrPageChange[], provider: string): { records: NormalizedPullRequest[]; deleted: string[] } {
  const records = new Map<string, NormalizedPullRequest>();
  const deleted = new Set<string>();
  for (const change of changes) {
    if (change.record) {
      const record = { ...change.record, provider };
      const existing = records.get(record.id);
      if (!existing || Date.parse(record.updatedAt) >= Date.parse(existing.updatedAt)) records.set(record.id, record);
      deleted.delete(record.id);
    } else if (change.deletedSourceId) {
      records.delete(change.deletedSourceId);
      deleted.add(change.deletedSourceId);
    }
  }
  return { records: [...records.values()], deleted: [...deleted] };
}

function asConnectorError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  return new ConnectorError("offline", error instanceof Error ? error.message : "connector transport failed", true);
}

async function fetchWithRetry(transport: ReadOnlyPrTransport, request: PrPageRequest, retries: number): Promise<{ raw: unknown; retries: number }> {
  let used = 0;
  for (;;) {
    try { return { raw: await transport.fetchPage(request), retries: used }; }
    catch (error) {
      const failure = asConnectorError(error);
      if (!failure.retryable || used >= retries) throw failure;
      used += 1;
      const retryAfterMs = failure.retryAfterMs;
      if (retryAfterMs && retryAfterMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterMs, 1_000)));
    }
  }
}

export async function syncPullRequests(config: Readonly<PrConnectorConfig>, transport: ReadOnlyPrTransport, store: PrSyncStore): Promise<readonly PrSyncRepositoryResult[]> {
  if (transport.route !== "synthetic-fixture" && transport.route !== "approved-claude-runner") throw new ConnectorError("configuration", "unapproved PR ingress route", false);
  const repositories = [...new Set(config.repositories)];
  if (repositories.length === 0 || repositories.some((repo) => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))) throw new ConnectorError("configuration", "an explicit repository allowlist is required", false);
  const sourceOrigins = [...new Set(config.sourceOrigins)];
  if (sourceOrigins.length === 0 || sourceOrigins.some((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.protocol !== "https:" || parsed.origin !== origin || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "";
    } catch { return true; }
  })) throw new ConnectorError("configuration", "an explicit canonical HTTPS source origin allowlist is required", false);
  if (config.scopes.length !== 1 || config.scopes[0] !== PR_READ_SCOPE) throw new ConnectorError("configuration", `the only approved scope is ${PR_READ_SCOPE}`, false);
  const limit = config.pageSize ?? MAX_PAGE_SIZE;
  const maxPages = config.maxPages ?? MAX_PAGES_PER_SYNC;
  const retryBudget = config.maxTransientRetries ?? 1;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_PER_SYNC || !Number.isInteger(retryBudget) || retryBudget < 0 || retryBudget > 3) {
    throw new ConnectorError("configuration", "connector bounds are invalid", false);
  }
  const connectorId = `pr:${config.provider}`;
  const results: PrSyncRepositoryResult[] = [];
  for (const repository of repositories) {
    let fetched = 0, deleted = 0, pages = 0, retries = 0;
    let cursor = await store.readCursor(connectorId, repository) ?? {};
    try {
      while (pages < maxPages) {
        const response = await fetchWithRetry(transport, { repository, scopes: [PR_READ_SCOPE], limit, ...(cursor.cursor ? { cursor: cursor.cursor } : {}), ...(!cursor.cursor && cursor.watermark ? { updatedSince: cursor.watermark } : {}) }, retryBudget);
        retries += response.retries;
        const page = parsePrPage(response.raw, repository, sourceOrigins);
        const normalized = deduplicate(page.changes, config.provider);
        const next = { ...(page.nextCursor ? { cursor: page.nextCursor } : {}), ...(page.watermark ? { watermark: page.watermark } : cursor.watermark ? { watermark: cursor.watermark } : {}) };
        await store.commitPage({ connectorId, repository, records: normalized.records, deletedSourceIds: normalized.deleted, cursor: next, observedAt: page.observedAt });
        cursor = next; fetched += normalized.records.length; deleted += normalized.deleted.length; pages += 1;
        if (!page.nextCursor) break;
      }
      if (pages === maxPages && cursor.cursor) throw new ConnectorError("configuration", "maximum page count reached before pagination completed", false);
      await store.clearFailure(connectorId, repository, new Date().toISOString());
      results.push({ repository, status: "success", fetched, deleted, pages, retries });
    } catch (error) {
      const failure = asConnectorError(error);
      const observedAt = new Date().toISOString();
      await store.recordFailure({ connectorId, repository, kind: failure.kind, message: failure.message, retryable: failure.retryable, observedAt });
      results.push({ repository, status: "error", fetched, deleted, pages, retries, error: { kind: failure.kind, message: failure.message, retryable: failure.retryable } });
    }
  }
  return results;
}
