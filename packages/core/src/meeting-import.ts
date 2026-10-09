import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type MeetingProposalKind = "action" | "decision" | "evidence";
export type MeetingProposalState = "proposed" | "approved" | "rejected";

export interface MeetingSourceAnchor {
  documentId: string;
  documentTitle: string;
  documentUri: string;
  anchor: string;
  quote: string;
}

export interface MeetingProposal {
  id: string;
  kind: MeetingProposalKind;
  text: string;
  owner?: string;
  dueAt?: string;
  subject?: string;
  source: MeetingSourceAnchor;
  state: MeetingProposalState;
  duplicateSuggestion?: { proposalId: string; similarity: number; decision: "manager-required" | "merge" | "separate" };
  mergedIntoProposalId?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewer?: string;
  reviewReason?: string;
}

export interface MeetingImportSummary {
  documentId: string;
  imported: number;
  ignored: number;
  retainedRawTranscript: false;
  proposalIds: readonly string[];
}

export type MeetingImportErrorCode = "not-approved" | "permission-denied" | "offline" | "not-found" | "invalid-note";
export type MeetingImportResult =
  | { ok: true; summary: MeetingImportSummary }
  | { ok: false; error: { code: MeetingImportErrorCode; message: string; retryable: boolean } };

export interface ReviewEdit {
  text?: string;
  owner?: string;
  dueAt?: string;
  subject?: string;
}

const MARKER = /^\s*[-*]\s*(ACTION|DECISION|EVIDENCE)\s*:\s*(?:\[([^\]]+)\]\s*)?(.+?)\s*$/i;
const SECRET = /\b(?:api[_-]?key|token|password)\s*[:=]\s*[^\s,;]+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function redact(value: string): string {
  return value.replace(SECRET, (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED_SECRET]`).replace(EMAIL, "[REDACTED_EMAIL]");
}

function parseMetadata(raw = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of raw.split(";")) {
    const [key, ...rest] = item.split("=");
    if (key?.trim() && rest.length) result[key.trim().toLowerCase()] = redact(rest.join("=").trim());
  }
  return result;
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2));
}

export function lexicalSimilarity(left: string, right: string): number {
  const a = words(left); const b = words(right);
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export class MeetingReviewQueue {
  readonly #items = new Map<string, MeetingProposal>();

  list(): readonly MeetingProposal[] {
    return [...this.#items.values()].map((item) => structuredClone(item));
  }

  get(id: string): MeetingProposal | undefined {
    const item = this.#items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  enqueue(input: Omit<MeetingProposal, "id" | "state" | "createdAt" | "duplicateSuggestion">, now: string): MeetingProposal {
    validateAnchor(input.source);
    const createdAt = utc(now);
    let duplicateSuggestion: MeetingProposal["duplicateSuggestion"];
    for (const candidate of this.#items.values()) {
      if (candidate.kind !== input.kind || candidate.state === "rejected") continue;
      const similarity = lexicalSimilarity(candidate.text, input.text);
      if (similarity >= 0.5) {
        duplicateSuggestion = { proposalId: candidate.id, similarity, decision: "manager-required" };
        break;
      }
    }
    const proposal: MeetingProposal = { ...structuredClone(input), id: randomUUID(), state: "proposed", createdAt, duplicateSuggestion };
    this.#items.set(proposal.id, proposal);
    return structuredClone(proposal);
  }

  edit(id: string, edit: ReviewEdit): MeetingProposal {
    const item = this.requireProposed(id);
    if (edit.text !== undefined) {
      const value = redact(edit.text.trim());
      if (!value) throw new Error("proposal text is required");
      item.text = value;
    }
    if (edit.owner !== undefined) item.owner = redact(edit.owner.trim());
    if (edit.dueAt !== undefined) item.dueAt = edit.dueAt;
    if (edit.subject !== undefined) item.subject = redact(edit.subject.trim());
    // Source provenance is intentionally not editable.
    return structuredClone(item);
  }

  decideDuplicate(id: string, decision: "merge" | "separate"): MeetingProposal {
    const item = this.requireProposed(id);
    if (!item.duplicateSuggestion) throw new Error("proposal has no duplicate suggestion");
    item.duplicateSuggestion.decision = decision;
    item.mergedIntoProposalId = decision === "merge" ? item.duplicateSuggestion.proposalId : undefined;
    return structuredClone(item);
  }

  accept(id: string, reviewer: string, reason: string, reviewedAt: string): MeetingProposal {
    const item = this.requireProposed(id);
    if (item.duplicateSuggestion?.decision === "manager-required") throw new Error("manager must decide whether duplicate proposals merge or remain separate");
    return this.finish(item, "approved", reviewer, reason, reviewedAt);
  }

  reject(id: string, reviewer: string, reason: string, reviewedAt: string): MeetingProposal {
    return this.finish(this.requireProposed(id), "rejected", reviewer, reason, reviewedAt);
  }

  private requireProposed(id: string): MeetingProposal {
    const item = this.#items.get(id);
    if (!item) throw new Error("proposal not found");
    if (item.state !== "proposed") throw new Error("reviewed proposals are immutable");
    return item;
  }

  private finish(item: MeetingProposal, state: "approved" | "rejected", reviewer: string, reason: string, reviewedAt: string): MeetingProposal {
    if (!reviewer.trim() || !reason.trim()) throw new Error("reviewer and reason are required");
    item.state = state; item.reviewer = reviewer.trim(); item.reviewReason = reason.trim(); item.reviewedAt = utc(reviewedAt);
    return structuredClone(item);
  }
}

export interface LocalMeetingImportOptions {
  approvedRoots: readonly string[];
  queue: MeetingReviewQueue;
  readText?: (path: string) => Promise<string>;
  resolveRealPath?: (path: string) => Promise<string>;
  idFactory?: (canonicalPath: string) => string;
}

export class LocalMeetingNoteImportAdapter {
  readonly #roots: readonly string[];
  readonly #queue: MeetingReviewQueue;
  readonly #readText: (path: string) => Promise<string>;
  readonly #resolveRealPath: (path: string) => Promise<string>;
  readonly #idFactory: (canonicalPath: string) => string;

  constructor(options: LocalMeetingImportOptions) {
    if (!options.approvedRoots.length) throw new Error("at least one approved local import root is required");
    this.#roots = options.approvedRoots.map((root) => resolve(root));
    this.#queue = options.queue;
    this.#readText = options.readText ?? ((path) => readFile(path, "utf8"));
    this.#resolveRealPath = options.resolveRealPath ?? realpath;
    this.#idFactory = options.idFactory ?? ((path) => createHash("sha256").update(path).digest("hex"));
  }

  async importFile(path: string, now = new Date().toISOString()): Promise<MeetingImportResult> {
    try {
      if (!isAbsolute(path)) return failure("not-approved", "Meeting note path must be absolute and inside an approved root", false);
      const canonical = await this.#resolveRealPath(path);
      if (!this.#roots.some((root) => within(root, canonical))) return failure("not-approved", "Meeting note is outside approved local import roots", false);
      const raw = await this.#readText(canonical);
      const documentId = this.#idFactory(canonical);
      const lines = raw.split(/\r?\n/);
      const ids: string[] = [];
      let ignored = 0;
      for (let index = 0; index < lines.length; index += 1) {
        const match = MARKER.exec(lines[index] ?? "");
        if (!match) { if (lines[index]?.trim()) ignored += 1; continue; }
        const kind = match[1]!.toLowerCase() as MeetingProposalKind;
        const metadata = parseMetadata(match[2]);
        const text = redact(match[3]!.trim());
        const quote = redact((lines[index] ?? "").trim()).slice(0, 500);
        const proposal = this.#queue.enqueue({
          kind, text, owner: metadata.owner, dueAt: metadata.due, subject: metadata.subject,
          source: { documentId, documentTitle: canonical.split(/[\\/]/).at(-1) ?? "meeting note", documentUri: `file://${canonical}`, anchor: `L${index + 1}`, quote },
        }, now);
        ids.push(proposal.id);
      }
      if (!ids.length) return failure("invalid-note", "No anchored ACTION, DECISION, or EVIDENCE proposals were found", false);
      return { ok: true, summary: { documentId, imported: ids.length, ignored, retainedRawTranscript: false, proposalIds: ids } };
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "EACCES" || code === "EPERM") return failure("permission-denied", "Permission denied while reading approved meeting note", false);
      if (code === "ENOENT") return failure("not-found", "Approved meeting note was not found", false);
      if (code === "ENETDOWN" || code === "ENETUNREACH" || code === "OFFLINE") return failure("offline", "Meeting note source is offline; no proposals were changed", true);
      return failure("invalid-note", "Meeting note import failed safely; no raw note was retained", false);
    }
  }
}

function validateAnchor(source: MeetingSourceAnchor): void {
  if (!source.documentId.trim() || !source.documentTitle.trim() || !source.documentUri.trim() || !source.anchor.trim() || !source.quote.trim()) {
    throw new Error("proposal requires quote and document anchor provenance");
  }
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function utc(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || !value.endsWith("Z")) throw new Error(`timestamp must be UTC ISO-8601: ${value}`);
  return date.toISOString();
}

function failure(code: MeetingImportErrorCode, message: string, retryable: boolean): MeetingImportResult {
  return { ok: false, error: { code, message, retryable } };
}
