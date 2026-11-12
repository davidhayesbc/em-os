import { z } from "zod";
import { Commitment, IsoDateTime, LocalDate } from "../entities/index.js";
import { Classification } from "../entities/meeting.js";
import { defineOp } from "../op.js";
import { MeetingPrep } from "./prep.js";

const Block = z.object({
  start: IsoDateTime,
  end: IsoDateTime,
  minutes: z.number().int(),
});

const DayPlan = z.object({
  freeBlocks: z.array(Block),
  placements: z.array(
    z.object({
      commitmentId: z.string(),
      blockIndex: z.number().int(),
      start: IsoDateTime,
      end: IsoDateTime,
    }),
  ),
  unplaced: z.array(z.string()),
});

const DayLoad = z.object({
  date: LocalDate,
  meetingMinutes: z.number().int(),
  workingMinutes: z.number().int(),
  loadRatio: z.number(),
  overloaded: z.boolean(),
  due: z.array(z.object({ commitmentId: z.string(), title: z.string() })),
});

const RankedItem = z.object({
  commitmentId: z.string(),
  score: z.number(),
  dominant: z.string(),
  why: z.string(),
  components: z.array(z.object({ kind: z.string(), points: z.number(), detail: z.string() })),
});

export const Today = z.object({
  localDate: LocalDate,
  timeZone: z.string(),
  onboarded: z.boolean(),
  header: z.object({
    meetingCount: z.number().int(),
    freeMinutes: z.number().int(),
    toTriage: z.number().int(),
    lastSyncAt: IsoDateTime.nullable(),
    failingConnectors: z.array(z.string()),
  }),
  weekLoad: z.array(DayLoad),
  timeline: z.object({
    meetings: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        start: IsoDateTime,
        end: IsoDateTime,
        classification: Classification,
        prepStatus: MeetingPrep.shape.status,
      }),
    ),
    plan: DayPlan,
  }),
  top: z.array(
    z.object({
      item: RankedItem.nullable(),
      commitment: Commitment,
      done: z.boolean(),
    }),
  ),
  waitingOn: z.array(Commitment),
  progress: z.object({
    done: z.number().int(),
    total: z.number().int(),
  }),
});

export type Today = z.infer<typeof Today>;

export const todayGet = defineOp({
  name: "today.get",
  input: z.object({ localDate: LocalDate.optional() }),
  output: Today,
});

export const todayRefresh = defineOp({
  name: "today.refresh",
  input: z.object({ localDate: LocalDate.optional() }),
  output: Today,
});
