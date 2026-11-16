import { z } from "zod";

export const CalendarEventDTO = z.object({
  externalId: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  status: z.enum(["confirmed", "cancelled", "tentative"]),
  attendees: z.array(
    z.object({
      email: z.string().nullable(),
      displayName: z.string().nullable(),
      self: z.boolean(),
      responseStatus: z.string().nullable(),
    }),
  ),
  url: z.string().nullable(),
  recurringEventId: z.string().nullable(),
});

export type CalendarEventDTO = z.infer<typeof CalendarEventDTO>;
