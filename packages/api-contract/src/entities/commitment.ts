import { z } from "zod";
import { Dated, IsoDateTime, LocalDate, type NewEntity } from "./common.js";

export const Direction = z.enum(["mine", "owed_to_me"]);
export type Direction = z.infer<typeof Direction>;

export const CommitmentStatus = z.enum(["proposed", "active", "snoozed", "done", "dropped"]);
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;

export const DropReason = z.enum(["user", "stale", "archived_on_import", "merged"]);
export type DropReason = z.infer<typeof DropReason>;

export const Urgency = z.enum(["now", "next", "soon", "later", "someday"]);
export type Urgency = z.infer<typeof Urgency>;

export const CreatedBy = z.enum(["user", "extractor", "import", "mcp"]);
export type CreatedBy = z.infer<typeof CreatedBy>;

export const CommitmentDue = z.object({
  date: LocalDate,
  time: z.string().nullable(), // local wall-clock time, null = all day
  timeZone: z.string(), // IANA zone
});
export type CommitmentDue = z.infer<typeof CommitmentDue>;

export const Recurrence = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().positive(),
  byWeekday: z.array(z.number().int().min(0).max(6)).nullable(),
  byMonthDay: z.number().int().min(1).max(31).nullable(),
});
export type Recurrence = z.infer<typeof Recurrence>;

export const Commitment = Dated.extend({
  id: z.string(),
  direction: Direction,
  status: CommitmentStatus,
  dropReason: DropReason.nullable(), // set only when status is "dropped"
  urgency: Urgency.nullable(),
  priority: z.number().int().min(0).max(3).nullable(), // p0..p3
  due: CommitmentDue.nullable(),
  tags: z.array(z.string()),
  createdBy: CreatedBy,
  ownerId: z.string(),
  counterpartId: z.string().nullable(),
  goalId: z.string().nullable(),
  meetingId: z.string().nullable(),
  title: z.string(),
  notes: z.string(),
  pinned: z.boolean(),
  effortMinutes: z.number().nullable(),
  snoozedUntil: IsoDateTime.nullable(),
  completedAt: IsoDateTime.nullable(),
  recurrence: Recurrence.nullable(),
  seriesId: z.string().nullable(), // shared by all occurrences of a recurring item
});
export type Commitment = z.infer<typeof Commitment>;
export type NewCommitment = NewEntity<Commitment>;
