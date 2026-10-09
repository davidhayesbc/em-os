import { createHash } from "node:crypto";

export type ReviewSource = "calendar" | "jira";
export type ReviewProposalKind = "calendar-follow-up" | "jira-action";

export interface IdentityCandidate { personId: string; label: string; confidence: number; }
export interface IdentityResolution {
  sourceIdentity: string;
  resolvedPersonId?: string;
  candidates: readonly IdentityCandidate[];
  prompt?: string;
}
export interface ReviewProposal {
  id: string;
  provider: ReviewSource;
  sourceId: string;
  scope: string;
  kind: ReviewProposalKind;
  title: string;
  occurredAt: string;
  observedAt: string;
  sourceUrl: string;
  sourceLinks: readonly string[];
  owner?: IdentityResolution;
  reviewState: "proposed";
  retentionUntil: string;
  dedupSuggestions: readonly string[];
}
export interface ReviewDeletion { provider: ReviewSource; sourceId: string; deletedAt: string; reason: "source_deleted" | "retention_expired"; }
export interface AdapterCommit {
  connector: ReviewSource;
  scope: string;
  previousCursor?: string;
  nextCursor?: string;
  observedAt: string;
  proposals: readonly ReviewProposal[];
  deletions: readonly ReviewDeletion[];
}
export interface ReviewQueueStore {
  getCursor(connector: ReviewSource, scope: string): Promise<string | undefined>;
  findDedupSuggestions(candidate: Pick<ReviewProposal, "provider" | "sourceId" | "title" | "occurredAt">): Promise<readonly string[]>;
  commit(batch: AdapterCommit): Promise<void>;
}
export interface AdapterPage<T> { items: readonly T[]; nextPageToken?: string; nextCursor?: string; observedAt: string; }
export interface ReadPageRequest { scope: string; cursor?: string; pageToken?: string; windowStart: string; windowEnd: string; }
export type ReadPage<T> = (request: Readonly<ReadPageRequest>) => Promise<AdapterPage<T>>;
export interface AdapterConfig {
  enabled: boolean;
  allowedScopes: readonly string[];
  windowStart: string;
  windowEnd: string;
  maxWindowDays: number;
  retentionDays: number;
  maxPages?: number;
}
export interface CalendarItem {
  id: string; calendarId: string; title: string; htmlLink: string; start: string; updatedAt: string;
  deleted?: boolean; organizer?: string; organizerCandidates?: readonly IdentityCandidate[]; relatedUrls?: readonly string[];
}
export interface JiraItem {
  id: string; projectKey: string; key: string; summary: string; browseUrl: string; updatedAt: string;
  deleted?: boolean; assignee?: string; assigneeCandidates?: readonly IdentityCandidate[]; relatedUrls?: readonly string[];
}
export interface SyncResult { status: "disabled" | "synced"; fetched: number; proposed: number; deleted: number; cursor?: string; }

export class AdapterPermissionError extends Error {
  constructor(readonly source: ReviewSource, readonly scope: string, message = "permission denied") {
    super(`${source} permission error for allowlisted scope ${scope}: ${message}`);
  }
}

function utc(value: string, field: string): string {
  // An offset or Z is mandatory: offset-free local timestamps are ambiguous at DST boundaries.
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw new Error(`${field} must include a timezone offset`);
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error(`${field} must be ISO-8601`);
  return date.toISOString();
}
function validateUrl(value: string, field: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${field} must use https`);
  url.hash = "";
  return url.toString();
}
function window(config: AdapterConfig): { start: string; end: string } {
  const start = utc(config.windowStart, "windowStart"); const end = utc(config.windowEnd, "windowEnd");
  const span = Date.parse(end) - Date.parse(start);
  if (span <= 0 || span > config.maxWindowDays * 86_400_000) throw new Error(`ingestion window must be positive and at most ${config.maxWindowDays} days`);
  if (!Number.isInteger(config.retentionDays) || config.retentionDays < 1) throw new Error("retentionDays must be a positive integer");
  return { start, end };
}
function identity(sourceIdentity: string | undefined, candidates: readonly IdentityCandidate[] | undefined): IdentityResolution | undefined {
  if (!sourceIdentity) return undefined;
  const choices = candidates ?? [];
  const confirmed = choices.filter(candidate => candidate.confidence === 1);
  if (confirmed.length === 1 && choices.length === 1) return { sourceIdentity, resolvedPersonId: confirmed[0].personId, candidates: choices };
  return { sourceIdentity, candidates: choices, prompt: choices.length ? `Confirm which person owns source identity ${sourceIdentity}; never merge by display name.` : `Map source identity ${sourceIdentity} to a person or leave it unresolved.` };
}
function retention(observedAt: string, days: number): string { return new Date(Date.parse(observedAt) + days * 86_400_000).toISOString(); }
function id(provider: ReviewSource, sourceId: string): string { return `${provider}:proposal:${createHash("sha256").update(sourceId).digest("hex").slice(0, 20)}`; }
function inWindow(value: string, start: string, end: string): boolean { const n = Date.parse(value); return n >= Date.parse(start) && n <= Date.parse(end); }
function uniqueLinks(primary: string, related: readonly string[] | undefined): readonly string[] {
  return [...new Set([primary, ...(related ?? [])].map((url, index) => validateUrl(url, index ? "related URL" : "source URL")))];
}

abstract class ReviewAdapter<T> {
  abstract readonly id: ReviewSource;
  constructor(protected readonly config: AdapterConfig, protected readonly readPage: ReadPage<T>, protected readonly store: ReviewQueueStore) {}
  protected abstract itemScope(item: T): string;
  protected abstract deleted(item: T): boolean;
  protected abstract deletedAt(item: T): string;
  protected abstract sourceId(item: T): string;
  protected abstract proposal(item: T, scope: string, observedAt: string, retentionUntil: string): Omit<ReviewProposal, "dedupSuggestions">;

  async sync(scope: string): Promise<SyncResult> {
    if (!this.config.enabled) return { status: "disabled", fetched: 0, proposed: 0, deleted: 0 };
    if (!this.config.allowedScopes.includes(scope)) throw new Error(`${this.id} scope is not allowlisted: ${scope}`);
    const { start, end } = window(this.config); const previousCursor = await this.store.getCursor(this.id, scope);
    const proposals: ReviewProposal[] = []; const deletions: ReviewDeletion[] = []; let pageToken: string | undefined; let nextCursor = previousCursor; let observedAt = end; let fetched = 0;
    const maxPages = this.config.maxPages ?? 100;
    for (let page = 0; ; page += 1) {
      if (page >= maxPages) throw new Error(`${this.id} pagination exceeded maxPages=${maxPages}`);
      let result: AdapterPage<T>;
      try { result = await this.readPage({ scope, cursor: previousCursor, pageToken, windowStart: start, windowEnd: end }); }
      catch (error) { if (error instanceof AdapterPermissionError) throw error; throw new Error(`${this.id} read failed for ${scope}: ${error instanceof Error ? error.message : String(error)}`); }
      observedAt = utc(result.observedAt, "observedAt"); nextCursor = result.nextCursor ?? nextCursor;
      for (const item of result.items) {
        fetched += 1;
        if (this.itemScope(item) !== scope) throw new Error(`${this.id} response escaped requested scope ${scope}`);
        if (this.deleted(item)) { deletions.push({ provider: this.id, sourceId: this.sourceId(item), deletedAt: utc(this.deletedAt(item), "deletedAt"), reason: "source_deleted" }); continue; }
        const candidate = this.proposal(item, scope, observedAt, retention(observedAt, this.config.retentionDays));
        if (!inWindow(candidate.occurredAt, start, end)) continue;
        proposals.push({ ...candidate, dedupSuggestions: await this.store.findDedupSuggestions(candidate) });
      }
      if (!result.nextPageToken) break;
      if (result.nextPageToken === pageToken) throw new Error(`${this.id} returned a repeated page token`);
      pageToken = result.nextPageToken;
    }
    await this.store.commit({ connector: this.id, scope, previousCursor, nextCursor, observedAt, proposals, deletions });
    return { status: "synced", fetched, proposed: proposals.length, deleted: deletions.length, cursor: nextCursor };
  }
}

export class CalendarReviewAdapter extends ReviewAdapter<CalendarItem> {
  readonly id = "calendar" as const;
  protected itemScope(item: CalendarItem): string { return item.calendarId; }
  protected deleted(item: CalendarItem): boolean { return item.deleted === true; }
  protected deletedAt(item: CalendarItem): string { return item.updatedAt; }
  protected sourceId(item: CalendarItem): string { return `${item.calendarId}:${item.id}`; }
  protected proposal(item: CalendarItem, scope: string, observedAt: string, retentionUntil: string): Omit<ReviewProposal, "dedupSuggestions"> {
    const sourceId = this.sourceId(item); const occurredAt = utc(item.start, "calendar start"); const sourceUrl = validateUrl(item.htmlLink, "calendar source URL");
    return { id: id(this.id, sourceId), provider: this.id, sourceId, scope, kind: "calendar-follow-up", title: item.title.trim(), occurredAt, observedAt, sourceUrl, sourceLinks: uniqueLinks(sourceUrl, item.relatedUrls), owner: identity(item.organizer, item.organizerCandidates), reviewState: "proposed", retentionUntil };
  }
}

export class JiraReviewAdapter extends ReviewAdapter<JiraItem> {
  readonly id = "jira" as const;
  protected itemScope(item: JiraItem): string { return item.projectKey; }
  protected deleted(item: JiraItem): boolean { return item.deleted === true; }
  protected deletedAt(item: JiraItem): string { return item.updatedAt; }
  protected sourceId(item: JiraItem): string { return `${item.projectKey}:${item.id}`; }
  protected proposal(item: JiraItem, scope: string, observedAt: string, retentionUntil: string): Omit<ReviewProposal, "dedupSuggestions"> {
    const sourceId = this.sourceId(item); const occurredAt = utc(item.updatedAt, "Jira updatedAt"); const sourceUrl = validateUrl(item.browseUrl, "Jira source URL");
    return { id: id(this.id, sourceId), provider: this.id, sourceId, scope, kind: "jira-action", title: `${item.key}: ${item.summary}`.trim(), occurredAt, observedAt, sourceUrl, sourceLinks: uniqueLinks(sourceUrl, item.relatedUrls), owner: identity(item.assignee, item.assigneeCandidates), reviewState: "proposed", retentionUntil };
  }
}

/** Synthetic/reference store: commit is atomic by replacement and cursors never advance on a failed commit. */
export class InMemoryReviewQueueStore implements ReviewQueueStore {
  readonly proposals = new Map<string, ReviewProposal>(); readonly deletions: ReviewDeletion[] = []; private readonly cursors = new Map<string, string>();
  failNextCommit = false;
  async getCursor(connector: ReviewSource, scope: string): Promise<string | undefined> { return this.cursors.get(`${connector}:${scope}`); }
  async findDedupSuggestions(candidate: Pick<ReviewProposal, "provider" | "sourceId" | "title" | "occurredAt">): Promise<readonly string[]> {
    const normalized = candidate.title.toLocaleLowerCase().replace(/^[A-Z][A-Z0-9]+-\d+:\s*/i, "").replace(/\W+/g, " ").trim();
    return [...this.proposals.values()].filter(item => !(item.provider === candidate.provider && item.sourceId === candidate.sourceId) && item.title.toLocaleLowerCase().replace(/^[A-Z][A-Z0-9]+-\d+:\s*/i, "").replace(/\W+/g, " ").trim() === normalized && Math.abs(Date.parse(item.occurredAt) - Date.parse(candidate.occurredAt)) <= 7 * 86_400_000).map(item => item.id);
  }
  async commit(batch: AdapterCommit): Promise<void> {
    if (this.failNextCommit) { this.failNextCommit = false; throw new Error("synthetic commit failure"); }
    for (const deletion of batch.deletions) { for (const [key, value] of this.proposals) if (value.provider === deletion.provider && value.sourceId === deletion.sourceId) this.proposals.delete(key); this.deletions.push(deletion); }
    for (const proposal of batch.proposals) this.proposals.set(proposal.id, proposal);
    if (batch.nextCursor) this.cursors.set(`${batch.connector}:${batch.scope}`, batch.nextCursor);
  }
  applyRetention(now: string): number {
    const at = utc(now, "retention now"); let removed = 0;
    for (const [key, proposal] of this.proposals) if (proposal.retentionUntil <= at) {
      this.proposals.delete(key); this.deletions.push({ provider: proposal.provider, sourceId: proposal.sourceId, deletedAt: at, reason: "retention_expired" }); removed += 1;
    }
    return removed;
  }
}
