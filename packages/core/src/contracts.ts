export type CiStatus = "passing" | "failing" | "pending" | "unknown";

export interface PullRequestRecord {
  provider: string; repository: string; id: string; title: string; url: string; author: string;
  isDraft: boolean; reviewRequestedOfViewer: boolean; ciStatus: CiStatus; ciUpdatedAt?: string; updatedAt: string;
}
export interface PullRequestFixture { schemaVersion: 1; fetchedAt: string; prs: PullRequestRecord[]; }
export interface SourceLink { label: string; url: string; }
export interface ScoreComponent { ruleId: string; points: number; explanation: string; }
export interface AttentionCandidate {
  key: string; kind: "review-requested" | "stale-ci"; title: string; reason: string; source: SourceLink;
  observedAt: string; ageMinutes: number; freshness: "fresh" | "stale";
  score?: number; scoreComponents?: readonly ScoreComponent[]; ruleIds?: readonly string[]; banner?: string;
  contextStatus?: "sufficient" | "insufficient" | "ambiguous-identity"; pinned?: boolean;
}
export interface AttentionOptions { now: Date; staleCiHours: number; staleDataHours: number; }

export type AttentionItemKind = "pull-request" | "action" | "initiative";
export type BlockerSeverity = "none" | "low" | "medium" | "high" | "critical";
export interface AttentionWorkItem {
  id: string; kind: AttentionItemKind; title: string; source: SourceLink; observedAt: string;
  explicitPriority?: number; blockerSeverity?: BlockerSeverity; dueAt?: string; waitingForManagerSince?: string;
  meetingStartsAt?: string; confidence?: number; initiativeId?: string; reviewRequested?: boolean;
  ciStatus?: CiStatus; ciUpdatedAt?: string; identityStatus?: "confirmed" | "ambiguous";
}
export interface AttentionFeedback {
  itemId: string; action: "pin" | "unpin" | "dismiss" | "snooze" | "correct"; reason: string; at: string;
  until?: string;
  correction?: Partial<Pick<AttentionWorkItem, "explicitPriority" | "blockerSeverity" | "dueAt" | "initiativeId">>;
}
export interface AttentionPolicy {
  staleDataHours: number; staleCiHours: number; dueSoonHours: number; managerWaitHours: number;
  meetingSoonHours: number; maxItems: number; maxPerKind: number; minimumScore: number;
  weights: {
    priority: number; blocker: Record<BlockerSeverity, number>; dueSoon: number; overdue: number;
    managerWait: number; meetingSoon: number; reviewRequested: number; staleCi: number;
    fresh: number; lowConfidence: number; insufficientContext: number;
  };
}
export interface RankedAttentionItem {
  key: string; kind: AttentionItemKind; title: string; reason: string; source: SourceLink; observedAt: string;
  ageMinutes: number; freshness: "fresh" | "stale"; score: number; scoreComponents: readonly ScoreComponent[];
  ruleIds: readonly string[]; banner: string; contextStatus: "sufficient" | "insufficient" | "ambiguous-identity";
  pinned: boolean;
}

export interface AppSettings { schemaVersion: 1; staleCiHours: number; staleDataHours: number; workspacePath?: string; }
export interface Storage {
  initialize(): Promise<void>;
  savePullRequests(records: readonly PullRequestRecord[], observedAt: string): Promise<void>;
  listPullRequests(): Promise<readonly PullRequestRecord[]>;
}
export interface Connector<TRecord> {
  readonly id: string;
  fetch(cursor?: string): Promise<{ records: readonly TRecord[]; nextCursor?: string; observedAt: string }>;
}
export interface AttentionRules {
  evaluate(records: readonly PullRequestRecord[], options: AttentionOptions): readonly AttentionCandidate[];
}
export interface DraftService {
  draftWeeklyUpdate(inputIds: readonly string[]): Promise<{ markdown: string; citations: readonly SourceLink[] }>;
}
export interface UserInterface {
  showAttention(items: readonly AttentionCandidate[]): Promise<void>;
  showError(message: string): Promise<void>;
  openSource(source: SourceLink): Promise<void>;
}
