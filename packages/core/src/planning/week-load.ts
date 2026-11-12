import type { Commitment, LocalDate, Meeting } from "@emos/api-contract";
import { addLocalDays, localWeekdayIndex, startOfLocalDay } from "../time/zoned.js";
import {
  type Interval,
  isBusy,
  localInstant,
  mergeIntervals,
  parseWallTime,
} from "./free-blocks.js";

export interface DayLoad {
  date: LocalDate;
  meetingMinutes: number;
  workingMinutes: number;
  loadRatio: number;
  overloaded: boolean;
  due: { commitmentId: string; title: string }[];
}

/**
 * Compute per-day meeting load for a work week.
 *
 * `workWeek` is a list of weekday indexes (0 = Sunday, 6 = Saturday). It is not
 * required to be contiguous, sorted, or unique. The week starts on the first
 * `workWeek` day on or before `weekOf`, where `workWeek[0]` defines the first
 * day. The result has one entry per distinct `workWeek` day, in listed order,
 * with duplicates collapsed by resolved date.
 */
export function weekLoad(i: {
  weekOf: LocalDate;
  workWeek: number[];
  timeZone: string;
  workingHours: { start: string; end: string };
  meetings: Meeting[];
  commitments: Commitment[];
}): DayLoad[] {
  if (i.workWeek.length === 0) return [];

  const firstDay = i.workWeek[0];
  if (firstDay == null) return [];

  const weekOfWeekday = localWeekdayIndex(i.weekOf);
  const daysBack = (weekOfWeekday - firstDay + 7) % 7;
  const weekStart = addLocalDays(i.weekOf, -daysBack);

  const workStart = parseWallTime(i.workingHours.start);
  const workEnd = parseWallTime(i.workingHours.end);
  if (workEnd <= workStart) {
    throw new RangeError("Working hours end must be after start");
  }

  const result: DayLoad[] = [];
  const seenDates = new Set<LocalDate>();

  for (let index = 0; index < i.workWeek.length; index += 1) {
    const weekday = i.workWeek[index];
    if (weekday == null) continue;
    const date = addLocalDays(weekStart, (weekday - firstDay + 7) % 7);
    if (seenDates.has(date)) continue;
    seenDates.add(date);

    const workStartMs = localInstant(date, i.timeZone, workStart).getTime();
    const workEndMs = localInstant(date, i.timeZone, workEnd).getTime();
    const workingMinutes = Math.round((workEndMs - workStartMs) / 60000);

    const dayStartMs = startOfLocalDay(date, i.timeZone).getTime();
    const nextDay = addLocalDays(date, 1);
    const dayEndMs = startOfLocalDay(nextDay, i.timeZone).getTime();

    const busyIntervals: Interval[] = [];
    for (const meeting of i.meetings) {
      if (!isBusy(meeting)) continue;

      const startInstant = new Date(meeting.start);
      const endInstant = new Date(meeting.end);
      if (Number.isNaN(startInstant.getTime()) || Number.isNaN(endInstant.getTime())) {
        throw new RangeError("Invalid meeting start/end");
      }
      if (endInstant.getTime() < startInstant.getTime()) {
        throw new RangeError("Meeting end before start");
      }

      const startMs = Math.max(dayStartMs, startInstant.getTime());
      const endMs = Math.min(dayEndMs, endInstant.getTime());
      if (endMs <= startMs) continue;

      const clippedStart = Math.max(startMs, workStartMs);
      const clippedEnd = Math.min(endMs, workEndMs);
      if (clippedEnd > clippedStart) {
        busyIntervals.push({ start: clippedStart, end: clippedEnd });
      }
    }

    const merged = mergeIntervals(busyIntervals);
    const meetingMinutes = merged.reduce(
      (sum, interval) => sum + Math.round((interval.end - interval.start) / 60000),
      0,
    );

    const loadRatio = workingMinutes === 0 ? 0 : meetingMinutes / workingMinutes;
    const overloaded = loadRatio >= 0.75;

    const due = i.commitments
      .filter(
        (c) =>
          c.status === "active" && c.direction === "mine" && c.due != null && c.due.date === date,
      )
      .map((c) => ({ commitmentId: c.id, title: c.title }));

    result.push({ date, meetingMinutes, workingMinutes, loadRatio, overloaded, due });
  }

  return result;
}
