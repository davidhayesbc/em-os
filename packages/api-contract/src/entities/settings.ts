import { z } from "zod";
import { LocalTime } from "./common.js";
import { Classification } from "./meeting.js";

const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));
const DisplayTimeZone = z
  .string()
  .refine((zone) => zone === "UTC" || supportedTimeZones.has(zone), "Unknown IANA time zone");

export const RankConfig = z.object({
  topN: z.number(),
  goalSlots: z.number(),
  timeCriticalHours: z.number(),
  weights: z.object({
    timeCritical: z.number(),
    overduePerDay: z.number(),
    hardDated: z.number(),
    waitingPerDay: z.number(),
    goal: z.number(),
    pin: z.number(),
    priority: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    urgencyNow: z.number(),
  }),
});
export type RankConfig = z.infer<typeof RankConfig>;

export const Notifications = z.object({
  meetingLeadMinutes: z.number(),
  morningDigestTime: LocalTime.nullable(),
  quietHours: z.object({ start: LocalTime, end: LocalTime }).nullable(),
  enabled: z.object({
    meetingSoon: z.boolean(),
    morningDigest: z.boolean(),
    wrapNudge: z.boolean(),
    connectorTrouble: z.boolean(),
  }),
});
export type Notifications = z.infer<typeof Notifications>;

export const Profile = z.object({
  selfPersonId: z.string().nullable(),
  displayTimeZone: DisplayTimeZone,
  workWeek: z.array(z.number().int().min(0).max(6)),
  workingHours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  meetingRules: z.array(z.object({ pattern: z.string(), classification: Classification })),
  rank: RankConfig,
  minFocusMinutes: z.number(),
  defaultEffortMinutes: z.number(),
  decayDays: z.number(),
  eodNudgeTime: z.string().nullable(),
  notifications: Notifications,
  onboarded: z.boolean(),
});
export type Profile = z.infer<typeof Profile>;

export const LayoutEntry = z.object({
  widgetId: z.string(),
  w: z.number(),
  h: z.number(),
});
export type LayoutEntry = z.infer<typeof LayoutEntry>;
export const LayoutSurface = z.enum(["dashboard", "sidebar"]);
export type LayoutSurface = z.infer<typeof LayoutSurface>;

export const DEFAULT_PROFILE: Profile = Profile.parse({
  selfPersonId: null,
  displayTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  workWeek: [1, 2, 3, 4, 5],
  workingHours: { start: "09:00", end: "17:00" },
  meetingRules: [],
  rank: {
    topN: 5,
    goalSlots: 1,
    timeCriticalHours: 24,
    weights: {
      timeCritical: 1000,
      overduePerDay: 50,
      hardDated: 400,
      waitingPerDay: 30,
      goal: 150,
      pin: 300,
      priority: [120, 80, 40, 0],
      urgencyNow: 100,
    },
  },
  minFocusMinutes: 15,
  defaultEffortMinutes: 30,
  decayDays: 14,
  eodNudgeTime: null,
  notifications: {
    meetingLeadMinutes: 10,
    morningDigestTime: "08:45",
    quietHours: { start: "19:00", end: "08:00" },
    enabled: {
      meetingSoon: true,
      morningDigest: true,
      wrapNudge: true,
      connectorTrouble: true,
    },
  },
  onboarded: false,
});
