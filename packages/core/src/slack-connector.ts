import { createHash } from "node:crypto";

export const SLACK_CONNECTOR_ID = "slack-public-review-queue" as const;
export const SLACK_REQUIRED_SCOPES = ["channels:history"] as const;
const FORBIDDEN_SCOPES = new Set(["groups:history", "im:history", "mpim:history", "chat:write"]);

export type SlackChannelKind = "public_channel" | "private_channel" | "im" | "mpim";
export type SlackProposalKind = "action" | "decision";
export type SlackClassification = "work" | "confidential";

export interface SlackScope {
  channelIds: readonly string[];
  windowStart: string;
  windowEnd: string;
  grantedScopes: readonly string[];
  classification: SlackClassification;
  retentionDays: number;
  maxExcerptChars: number;
}

export interface SlackMessageDto {
  id: string;
  channelId: string;
  channelKind: SlackChannelKind;
  occurredAt: string;
  updatedAt?: string;
  text?: string;
  permalink?: string;
  deleted?: boolean;
  proposalKind?: SlackProposalKind;
}

export interface SlackPageDto {
  schemaVersion: 1;
  cursor?: string;
  nextCursor?: string;
  observedAt: string;
  messages: readonly SlackMessageDto[];
}

export interface SlackSourceRecord {
  id: string;
  provider: "slack";
  sourceId: string;
  stableUrl?: string;
  occurredAt: string;
  observedAt: string;
  excerpt: string;
  contentHash: string;
  classification: SlackClassification;
  lastSeenAt: string;
  retentionUntil: string;
}

export interface SlackReviewProposal {
  id: string;
  kind: SlackProposalKind;
  description: string;
  sourceRecordId: string;
}

export interface SlackPersistencePage {
  connector: typeof SLACK_CONNECTOR_ID;
  scope: string;
  cursor?: string;
  observedAt: string;
  records: readonly SlackSourceRecord[];
  deletedSourceIds: readonly string[];
  proposals: readonly SlackReviewProposal[];
}

export interface SlackPageSource {
  fetchPage(cursor: string | undefined, request: Readonly<{ channelIds: readonly string[]; oldest: string; latest: string; limit: number }>): Promise<unknown>;
}

export interface SlackSyncStore {
  getCursor(connector: string, scope: string): string | undefined;
  persistSlackPage(page: SlackPersistencePage): void;
  recordSlackError(connector: string, scope: string, message: string): void;
}

export interface SlackSyncResult {
  pages: number;
  fetched: number;
  persisted: number;
  deleted: number;
  proposed: number;
  cursor?: string;
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

function parseMessage(value: unknown): SlackMessageDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("message must be an object");
  const row = value as Record<string, unknown>;
  exactKeys(row, ["id", "channelId", "channelKind", "occurredAt", "updatedAt", "text", "permalink", "deleted", "proposalKind"], "message");
  const channelKind = row.channelKind;
  if (!(["public_channel", "private_channel", "im", "mpim"] as const).includes(channelKind as SlackChannelKind)) throw new Error("unsupported Slack channel kind");
  const proposalKind = row.proposalKind;
  if (proposalKind !== undefined && proposalKind !== "action" && proposalKind !== "decision") throw new Error("unsupported proposal kind");
  if (typeof row.deleted !== "undefined" && typeof row.deleted !== "boolean") throw new Error("deleted must be boolean");
  return {
    id: boundedString(row.id, "message.id", 128)!,
    channelId: boundedString(row.channelId, "message.channelId", 64)!,
    channelKind: channelKind as SlackChannelKind,
    occurredAt: utc(row.occurredAt, "message.occurredAt"),
    updatedAt: row.updatedAt === undefined ? undefined : utc(row.updatedAt, "message.updatedAt"),
    text: boundedString(row.text, "message.text", 12_000, false),
    permalink: boundedString(row.permalink, "message.permalink", 2_048, false),
    deleted: row.deleted as boolean | undefined,
    proposalKind: proposalKind as SlackProposalKind | undefined,
  };
}

export function parseSlackPage(value: unknown): SlackPageDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Slack page must be an object");
  const row = value as Record<string, unknown>;
  exactKeys(row, ["schemaVersion", "cursor", "nextCursor", "observedAt", "messages"], "Slack page");
  if (row.schemaVersion !== 1) throw new Error("unsupported Slack page schema");
  if (!Array.isArray(row.messages) || row.messages.length > 200) throw new Error("Slack page messages must be an array of at most 200 items");
  return {
    schemaVersion: 1,
    cursor: boundedString(row.cursor, "cursor", 512, false),
    nextCursor: boundedString(row.nextCursor, "nextCursor", 512, false),
    observedAt: utc(row.observedAt, "observedAt"),
    messages: row.messages.map(parseMessage),
  };
}

function validateScope(scope: SlackScope): { start: string; end: string; scopeKey: string } {
  const start = utc(scope.windowStart, "windowStart");
  const end = utc(scope.windowEnd, "windowEnd");
  if (start > end) throw new Error("Slack time window is invalid");
  const channels = [...new Set(scope.channelIds)];
  if (!channels.length || channels.some((id) => !/^C[A-Z0-9]{2,63}$/.test(id))) throw new Error("an explicit public-channel allowlist is required");
  if (channels.length !== scope.channelIds.length) throw new Error("Slack channel allowlist contains duplicates");
  const grants = new Set(scope.grantedScopes);
  if (scope.grantedScopes.length !== SLACK_REQUIRED_SCOPES.length || !SLACK_REQUIRED_SCOPES.every((value) => grants.has(value)) || scope.grantedScopes.some((value) => FORBIDDEN_SCOPES.has(value) || !SLACK_REQUIRED_SCOPES.includes(value as typeof SLACK_REQUIRED_SCOPES[number]))) {
    throw new Error("unsupported Slack permissions; exact channels:history read scope required");
  }
  if (scope.classification !== "work" && scope.classification !== "confidential") throw new Error("unsupported content classification");
  if (!Number.isInteger(scope.retentionDays) || scope.retentionDays < 1 || scope.retentionDays > 365) throw new Error("retentionDays must be between 1 and 365");
  if (!Number.isInteger(scope.maxExcerptChars) || scope.maxExcerptChars < 1 || scope.maxExcerptChars > 2_000) throw new Error("maxExcerptChars must be between 1 and 2000");
  return { start, end, scopeKey: channels.slice().sort().join(",") };
}

function retentionFrom(observedAt: string, days: number): string {
  return new Date(new Date(observedAt).valueOf() + days * 86_400_000).toISOString();
}

function digest(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown Slack connector failure";
  return message.replace(/[\r\n]/g, " ").slice(0, 300);
}

export class SlackReviewQueueAdapter {
  constructor(private readonly source: SlackPageSource, private readonly store: SlackSyncStore, private readonly maxRetries = 2) {}

  async sync(scope: SlackScope): Promise<SlackSyncResult> {
    const validated = validateScope(scope);
    const savedCursor = this.store.getCursor(SLACK_CONNECTOR_ID, validated.scopeKey);
    const savedWatermark = savedCursor?.endsWith("Z") && Number.isFinite(new Date(savedCursor).valueOf()) ? savedCursor : undefined;
    const oldest = savedWatermark && savedWatermark > validated.start ? savedWatermark : validated.start;
    let cursor = savedWatermark ? undefined : savedCursor;
    let pages = 0, fetched = 0, persisted = 0, deleted = 0, proposed = 0;
    const seenCursors = new Set<string | undefined>();
    try {
      while (true) {
        if (seenCursors.has(cursor)) throw new Error("Slack pagination cursor repeated");
        seenCursors.add(cursor);
        let raw: unknown;
        let attempt = 0;
        while (true) {
          try { raw = await this.source.fetchPage(cursor, { channelIds: scope.channelIds, oldest, latest: validated.end, limit: 200 }); break; }
          catch (error) { if (attempt++ >= this.maxRetries) throw error; }
        }
        const page = parseSlackPage(raw);
        if (page.cursor !== cursor) throw new Error("Slack response cursor does not match requested cursor");
        const records: SlackSourceRecord[] = [];
        const deletedSourceIds: string[] = [];
        const proposals: SlackReviewProposal[] = [];
        for (const message of page.messages) {
          fetched++;
          if (message.channelKind !== "public_channel") throw new Error("private channels and DMs are outside Slack connector scope");
          if (!scope.channelIds.includes(message.channelId)) throw new Error("Slack response included a non-allowlisted channel");
          if (message.occurredAt < validated.start || message.occurredAt > validated.end) throw new Error("Slack response included a message outside the approved time window");
          const sourceId = `${message.channelId}:${message.id}`;
          if (message.deleted) { deletedSourceIds.push(sourceId); continue; }
          const excerpt = (message.text ?? "").slice(0, scope.maxExcerptChars);
          const sourceRecordId = `slack:message:${sourceId}`;
          records.push({ id: sourceRecordId, provider: "slack", sourceId, stableUrl: message.permalink, occurredAt: message.occurredAt, observedAt: page.observedAt, excerpt, contentHash: digest(excerpt), classification: scope.classification, lastSeenAt: page.observedAt, retentionUntil: retentionFrom(page.observedAt, scope.retentionDays) });
          if (message.proposalKind) proposals.push({ id: `slack:proposal:${sourceId}`, kind: message.proposalKind, description: excerpt, sourceRecordId });
        }
        const committedCursor = page.nextCursor ?? page.observedAt;
        this.store.persistSlackPage({ connector: SLACK_CONNECTOR_ID, scope: validated.scopeKey, cursor: committedCursor, observedAt: page.observedAt, records, deletedSourceIds, proposals });
        pages++; persisted += records.length; deleted += deletedSourceIds.length; proposed += proposals.length;
        cursor = page.nextCursor;
        if (!cursor) return { pages, fetched, persisted, deleted, proposed, cursor: committedCursor };
      }
    } catch (error) {
      this.store.recordSlackError(SLACK_CONNECTOR_ID, validated.scopeKey, safeError(error));
      throw error;
    }
  }
}
