import { z } from "zod";
import { Meeting, SourceItem } from "../entities/index.js";
import { defineOp } from "../op.js";

const MeetingPatch = Meeting.pick({
  classification: true,
  personId: true,
  actionItems: true,
}).partial();

export const meetingsList = defineOp({
  name: "meetings.list",
  input: z.object({
    from: Meeting.shape.start,
    to: Meeting.shape.end,
    personId: z.string().optional(),
    classification: Meeting.shape.classification.optional(),
  }),
  output: z.array(Meeting),
});

export const meetingsGet = defineOp({
  name: "meetings.get",
  input: z.object({ id: z.string() }),
  output: z.object({ meeting: Meeting, notes: z.array(SourceItem) }),
});

export const meetingsUpdate = defineOp({
  name: "meetings.update",
  input: z.object({ id: z.string(), patch: MeetingPatch }),
  output: Meeting,
});

const NoteKind = z.enum(["summary", "transcript"]);

export const meetingsAttachNotes = defineOp({
  name: "meetings.attachNotes",
  input: z.object({
    meetingId: z.string(),
    text: z.string().min(1).max(100_000),
    kind: NoteKind,
  }),
  output: SourceItem,
});
