import { z } from "zod";
import {
  Commitment,
  CommitmentDue,
  Direction,
  Person,
  Recurrence,
  Urgency,
} from "../entities/index.js";
import { defineOp } from "../op.js";

export const ParsedCapture = z.object({
  title: z.string(),
  direction: Direction,
  personQuery: z.string().nullable(),
  due: CommitmentDue.nullable(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  urgency: Urgency.nullable(),
  tags: z.array(z.string()),
  recurrence: Recurrence.nullable(),
});
export type ParsedCapture = z.infer<typeof ParsedCapture>;

export const commitmentsQuickCapture = defineOp({
  name: "commitments.quickCapture",
  input: z.object({ text: z.string(), counterpartId: z.string().optional() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("created"), commitment: Commitment }),
    z.object({
      status: z.literal("needs_person"),
      parsed: ParsedCapture,
      candidates: z.array(Person),
    }),
    z.object({ status: z.literal("invalid"), message: z.string() }),
  ]),
});
