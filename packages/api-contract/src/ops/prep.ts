import { z } from "zod";
import { CommitmentView, IsoDateTime, Meeting, Person } from "../entities/index.js";
import { defineOp } from "../op.js";

export const MeetingPrep = z.object({
  meetingId: z.string(),
  classification: Meeting.shape.classification,
  status: z.enum(["ready", "needs_work", "nothing_linked"]),
  person: Person.nullable(),
  openMine: z.array(CommitmentView),
  openTheirs: z.array(CommitmentView),
  linked: z.array(CommitmentView),
  lastNotes: z
    .object({
      sourceItemId: z.string(),
      occurredAt: IsoDateTime,
      excerpt: z.string(),
    })
    .nullable(),
  carriedActionItems: z.array(Meeting.shape.actionItems.element),
});

export const prepGet = defineOp({
  name: "prep.get",
  input: z.object({ meetingId: z.string() }),
  output: MeetingPrep,
});
