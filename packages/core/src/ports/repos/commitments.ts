import type {
  AuditEvent,
  Commitment,
  CommitmentStatus,
  CreatedBy,
  Direction,
  DropReason,
  IsoDateTime,
  LocalDate,
  NewCommitment,
} from "@emos/api-contract";

export type CommitmentAction =
  | "activate"
  | "complete"
  | "snooze"
  | "drop"
  | "reopen"
  | "edit"
  | "pin"
  | "unpin";

export interface CommitmentsRepo {
  create(c: NewCommitment, sourceIds?: string[]): Commitment;
  save(
    c: Commitment,
    audit: { action: CommitmentAction; actor: "user" | "import" | "system"; note?: string },
  ): Commitment;
  get(id: string): Commitment | null;
  audit(id: string): AuditEvent[];
  list(f: {
    status?: CommitmentStatus[];
    direction?: Direction;
    counterpartId?: string;
    meetingId?: string;
    goalId?: string;
    createdBy?: CreatedBy[];
    dueOnOrBefore?: LocalDate;
  }): Commitment[];
  sources(id: string): import("@emos/api-contract").SourceItem[];
}

export type { DropReason, IsoDateTime };
