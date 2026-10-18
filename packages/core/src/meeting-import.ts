import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { redact } from "./redact.js";
import type { AdapterCommit, ReviewDeletion, ReviewProposal, ReviewQueueStore, ReviewSource } from "./review-adapters.js";

export const MEETING_CONNECTOR_ID: ReviewSource = "meeting-notes";

export type MeetingNoteClassification = "work" | "confidential";
export type MeetingNoteProposalKind = "action" | "decision";

/** Scope for one meeting-note document. The approved root is validated but never persisted. */
export interface MeetingNoteScope {
  approvedRoot: string;
  allowedLabels: readonly string[];
  documentLabel: string;
  windowStart: string;
  windowEnd: string;
  classification: MeetingNoteClassification;
  retentionDays: number;
  maxTitleChars?: number;
  maxBodyChars?: number;
}

export interface MeetingNoteItem {
  id: string;
  title: string;
  body?: string;
  occurredAt: string;
  updatedAt?: string;
  deleted?: boolean;
  proposalKind?: MeetingNoteProposalKind;
}

export interface MeetingNotePageDto {
  schemaVersion: 1;
  documentId: string;
  documentLabel: string;
  cursor?: string;
  nextCursor?: string;
  observedAt: string;
  items: readonly MeetingNoteItem[];
}

export interface MeetingNotePageSource {
  fetchPage(
    cursor: string | undefined,
    request: Readonly<{ documentId: string; documentLabel: string; windowStart: string; windowEnd: string; limit: number }>,
  ): Promise<unknown>;
}

export interface MeetingNoteSyncResult {
  status: "synced";
  fetched: number;
  proposed: number;
  deleted: number;
  cursor?: string;
}

const MAX_PAGE_ITEMS = 200;
const DEFAULT_MAX_TITLE_CHARS = 200;
const DEFAULT_MAX_BODY_CHARS = 1000;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_TOTAL_ITEMS = 20_000;
const SOURCE_URL_BASE = "https://example.invalid/meeting-notes/";

function documentId(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

function stableSourceUrl(label: string): string {
  return `${SOURCE_URL_BASE}${encodeURIComponent(label)}`;
}

function id(sourceId: string): string {
  return `${MEETING_CONNECTOR_ID}:proposal:${createHash("sha256").update(sourceId).digest("hex").slice(0, 20)}`;
}

function contentHash(payload: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

function retention(observedAt: string, days: number): string {
  return new Date(Date.parse(observedAt) + days * 86_400_000).toISOString();
}

function utc(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.endsWith("Z")) throw new Error(`${field} must be UTC ISO-8601`);
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error(`${field} must be UTC ISO-8601`);
  return date.toISOString();
}

function boundedString(value: unknown, field: string, max: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || (required && value.length === 0) || value.length > max) throw new Error(`${field} is invalid or exceeds ${max} characters`);
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${field} contains unsupported fields: ${unexpected.join(",")}`);
}

function parseItem(value: unknown, maxTitleChars: number, maxBodyChars: number): MeetingNoteItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("meeting note item must be an object");
  const row = value as Record<string, unknown>;
  exactKeys(row, ["id", "title", "body", "occurredAt", "updatedAt", "deleted", "proposalKind"], "meeting note item");
  const deleted = row.deleted;
  if (deleted !== undefined && typeof deleted !== "boolean") throw new Error("item.deleted must be boolean");
  const proposalKind = row.proposalKind;
  if (proposalKind !== undefined && proposalKind !== "action" && proposalKind !== "decision") throw new Error("unsupported proposal kind");
  return {
    id: boundedString(row.id, "item.id", 128)!,
    title: boundedString(row.title, "item.title", maxTitleChars)!,
    body: boundedString(row.body, "item.body", maxBodyChars, false),
    occurredAt: utc(row.occurredAt, "item.occurredAt"),
    updatedAt: row.updatedAt === undefined ? undefined : utc(row.updatedAt, "item.updatedAt"),
    deleted: deleted as boolean | undefined,
    proposalKind: proposalKind as MeetingNoteProposalKind | undefined,
  };
}

function parsePage(
  value: unknown,
  expectedDocumentId: string,
  expectedDocumentLabel: string,
  maxTitleChars: number,
  maxBodyChars: number,
): MeetingNotePageDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("meeting note page must be an object");
  const row = value as Record<string, unknown>;
  exactKeys(row, ["schemaVersion", "documentId", "documentLabel", "cursor", "nextCursor", "observedAt", "items"], "meeting note page");
  if (row.schemaVersion !== 1) throw new Error("unsupported meeting note page schema");
  const documentId = boundedString(row.documentId, "page.documentId", 128)!;
  if (documentId !== expectedDocumentId) throw new Error("meeting note page document id does not match expected id");
  const documentLabel = boundedString(row.documentLabel, "page.documentLabel", 1024)!;
  if (documentLabel !== expectedDocumentLabel) throw new Error("meeting note page document label does not match expected label");
  if (!Array.isArray(row.items) || row.items.length > MAX_PAGE_ITEMS) throw new Error(`meeting note page items must be an array of at most ${MAX_PAGE_ITEMS} items`);
  return {
    schemaVersion: 1,
    documentId,
    documentLabel,
    cursor: boundedString(row.cursor, "page.cursor", 512, false),
    nextCursor: boundedString(row.nextCursor, "page.nextCursor", 512, false),
    observedAt: utc(row.observedAt, "page.observedAt"),
    items: row.items.map((item) => parseItem(item, maxTitleChars, maxBodyChars)),
  };
}

function validateScope(scope: MeetingNoteScope): { start: string; end: string; docId: string; docUrl: string; maxTitleChars: number; maxBodyChars: number } {
  if (!scope.approvedRoot || typeof scope.approvedRoot !== "string" || !isAbsolute(scope.approvedRoot)) throw new Error("approvedRoot must be an absolute path");
  if (!scope.documentLabel || typeof scope.documentLabel !== "string") throw new Error("documentLabel is required");
  if (scope.documentLabel.startsWith("/") || scope.documentLabel.includes("..") || /[\\:*?"<>|]/.test(scope.documentLabel)) throw new Error("documentLabel must be a relative path without traversal");
  if (!scope.allowedLabels.includes(scope.documentLabel)) throw new Error("documentLabel is not in the allowed labels list");
  const start = utc(scope.windowStart, "windowStart");
  const end = utc(scope.windowEnd, "windowEnd");
  if (start > end) throw new Error("meeting note time window is invalid");
  if (scope.classification !== "work" && scope.classification !== "confidential") throw new Error("unsupported content classification");
  if (!Number.isInteger(scope.retentionDays) || scope.retentionDays < 1 || scope.retentionDays > 365) throw new Error("retentionDays must be between 1 and 365");
  const maxTitleChars = scope.maxTitleChars ?? DEFAULT_MAX_TITLE_CHARS;
  const maxBodyChars = scope.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
  if (!Number.isInteger(maxTitleChars) || maxTitleChars < 1 || maxTitleChars > 2_000) throw new Error("maxTitleChars must be between 1 and 2000");
  if (!Number.isInteger(maxBodyChars) || maxBodyChars < 1 || maxBodyChars > 12_000) throw new Error("maxBodyChars must be between 1 and 12000");
  const docId = documentId(scope.documentLabel);
  return { start, end, docId, docUrl: stableSourceUrl(scope.documentLabel), maxTitleChars, maxBodyChars };
}

function inWindow(value: string, start: string, end: string): boolean {
  const n = Date.parse(value);
  return n >= Date.parse(start) && n <= Date.parse(end);
}

export class MeetingNoteReviewQueueAdapter {
  constructor(
    private readonly source: MeetingNotePageSource,
    private readonly store: ReviewQueueStore,
    private readonly maxPages = DEFAULT_MAX_PAGES,
    private readonly maxTotalItems = DEFAULT_MAX_TOTAL_ITEMS,
  ) {}

  async sync(scope: MeetingNoteScope): Promise<MeetingNoteSyncResult> {
    const validated = validateScope(scope);
    const previousCursor = await this.store.getCursor(MEETING_CONNECTOR_ID, scope.documentLabel);
    let cursor: string | undefined = previousCursor;
    let fetched = 0, proposed = 0, deleted = 0;
    let pageCount = 0;
    let observedAt = validated.end;
    let nextCursor: string | undefined = previousCursor;
    const seenCursors = new Set<string | undefined>();
    const proposals: ReviewProposal[] = [];
    const deletions: ReviewDeletion[] = [];

    while (true) {
      if (pageCount >= this.maxPages) throw new Error(`meeting-notes pagination exceeded maxPages=${this.maxPages}`);
      if (seenCursors.has(cursor)) throw new Error("meeting note pagination cursor repeated");
      seenCursors.add(cursor);
      let raw: unknown;
      try {
        raw = await this.source.fetchPage(cursor, {
          documentId: validated.docId,
          documentLabel: scope.documentLabel,
          windowStart: validated.start,
          windowEnd: validated.end,
          limit: MAX_PAGE_ITEMS,
        });
      } catch (error) {
        throw new Error(`meeting note read failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      const page = parsePage(raw, validated.docId, scope.documentLabel, validated.maxTitleChars, validated.maxBodyChars);
      if (page.cursor !== cursor) throw new Error("meeting note response cursor does not match requested cursor");
      pageCount += 1;
      observedAt = page.observedAt;

      for (const item of page.items) {
        if (fetched >= this.maxTotalItems) throw new Error(`meeting-notes pagination exceeded maxTotalItems=${this.maxTotalItems}`);
        fetched += 1;
        const sourceId = `${validated.docId}:${item.id}`;
        const redactedTitle = redact(item.title).slice(0, validated.maxTitleChars);
        const redactedBody = item.body === undefined ? undefined : redact(item.body).slice(0, validated.maxBodyChars);
        if (item.deleted) {
          deletions.push({
            provider: MEETING_CONNECTOR_ID,
            sourceId,
            contentHash: contentHash({ id: item.id, title: redactedTitle, body: redactedBody, occurredAt: item.occurredAt }),
            deletedAt: item.updatedAt ?? page.observedAt,
            reason: "source_deleted",
          });
          continue;
        }
        if (!inWindow(item.occurredAt, validated.start, validated.end)) continue;
        const candidate: ReviewProposal = {
          id: id(sourceId),
          provider: MEETING_CONNECTOR_ID,
          sourceId,
          scope: scope.documentLabel,
          kind: item.proposalKind ?? "action",
          title: redactedTitle,
          occurredAt: item.occurredAt,
          observedAt: page.observedAt,
          sourceUrl: validated.docUrl,
          sourceLinks: [validated.docUrl],
          reviewState: "proposed",
          retentionUntil: retention(page.observedAt, scope.retentionDays),
          dedupSuggestions: [],
          classification: scope.classification,
        };
        candidate.dedupSuggestions = await this.store.findDedupSuggestions(candidate);
        proposals.push(candidate);
      }

      if (!page.nextCursor) {
        // Clear the cursor when the source reports no next page; a later completed
        // sync starts from the beginning rather than re-fetching the final page.
        nextCursor = undefined;
        break;
      }
      nextCursor = page.nextCursor;
      cursor = page.nextCursor;
    }

    const batch: AdapterCommit = {
      connector: MEETING_CONNECTOR_ID,
      scope: scope.documentLabel,
      previousCursor,
      nextCursor,
      cursorUpdate: nextCursor === undefined ? { kind: "clear" } : { kind: "set", value: nextCursor },
      observedAt,
      fetched,
      proposals,
      deletions,
    };
    await this.store.commit(batch);
    proposed = proposals.length;
    deleted = deletions.length;
    return { status: "synced", fetched, proposed, deleted, cursor: nextCursor };
  }
}
