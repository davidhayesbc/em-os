export type CiStatus = "passing" | "failing" | "pending" | "unknown";

export interface PullRequestRecord {
  provider: string;
  repository: string;
  id: string;
  title: string;
  url: string;
  author: string;
  isDraft: boolean;
  reviewRequestedOfViewer: boolean;
  ciStatus: CiStatus;
  ciUpdatedAt?: string;
  updatedAt: string;
}

export interface PullRequestFixture {
  schemaVersion: 1;
  fetchedAt: string;
  prs: PullRequestRecord[];
}

export interface SourceLink {
  label: string;
  url: string;
}

export interface AttentionCandidate {
  key: string;
  kind: "review-requested" | "stale-ci";
  title: string;
  reason: string;
  source: SourceLink;
  observedAt: string;
  ageMinutes: number;
  freshness: "fresh" | "stale";
}

export interface AttentionOptions {
  now: Date;
  staleCiHours: number;
  staleDataHours: number;
}

export interface AppSettings {
  schemaVersion: 1;
  staleCiHours: number;
  staleDataHours: number;
  workspacePath?: string;
}

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
