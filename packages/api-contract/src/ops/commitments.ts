import { z } from "zod";
import {
  AuditEvent,
  Commitment,
  CommitmentStatus,
  CreatedBy,
  Direction,
  DropReason,
  LocalDate,
  SourceItem,
} from "../entities/index.js";
import { defineOp } from "../op.js";

const NewCommitment = Commitment.omit({
  id: true,
  capturedAt: true,
  updatedAt: true,
  occurredAt: true,
  retentionState: true,
}).extend({
  occurredAt: Commitment.shape.occurredAt.optional(),
  retentionState: Commitment.shape.retentionState.optional(),
});
const Id = z.object({ id: z.string() });
export const commitmentsList = defineOp({
  name: "commitments.list",
  input: z.object({
    status: z.array(CommitmentStatus).optional(),
    direction: Direction.optional(),
    counterpartId: z.string().optional(),
    meetingId: z.string().optional(),
    goalId: z.string().optional(),
    createdBy: z.array(CreatedBy).optional(),
    dueOnOrBefore: LocalDate.optional(),
  }),
  output: z.array(Commitment),
});
export const commitmentsGet = defineOp({
  name: "commitments.get",
  input: Id,
  output: z.object({
    commitment: Commitment,
    sources: z.array(SourceItem),
    audit: z.array(AuditEvent),
  }),
});
export const commitmentsCreate = defineOp({
  name: "commitments.create",
  input: NewCommitment.extend({ sourceIds: z.array(z.string()).optional() }),
  output: Commitment,
});
export const commitmentsUpdate = defineOp({
  name: "commitments.update",
  input: Id.extend({ patch: NewCommitment.partial() }),
  output: Commitment,
});
export const commitmentsComplete = defineOp({
  name: "commitments.complete",
  input: Id,
  output: Commitment,
});
export const commitmentsSnooze = defineOp({
  name: "commitments.snooze",
  input: Id.extend({ until: Commitment.shape.snoozedUntil.unwrap() }),
  output: Commitment,
});
export const commitmentsDrop = defineOp({
  name: "commitments.drop",
  input: Id.extend({ reason: DropReason }),
  output: Commitment,
});
export const commitmentsReopen = defineOp({
  name: "commitments.reopen",
  input: Id,
  output: Commitment,
});
export const commitmentsPin = defineOp({
  name: "commitments.pin",
  input: Id.extend({ pinned: z.boolean() }),
  output: Commitment,
});
