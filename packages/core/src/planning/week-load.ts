import type { Commitment, LocalDate, Meeting } from "@emos/api-contract";
import { addLocalDays, localWeekdayIndex, startOfLocalDay } from "../time/zoned.js";
import { type Interval, localInstant, mergeIntervals } from "./free-blocks.js";

export interface DayLoad {
  date: LocalDate;
  meetingMinutes: number;
  workingMinutes: number;
  loadRatio: number;
  overloaded: boolean;
  due: { commitmentId: string; title: string }[];
}

const WALL_TIME_RE = /^(\d{1,2}):(\d{2})$/;

function parseWallTime(s: string): number {
  const match = WALL_TIME_RE.exec(s);
  if (!match) throw new RangeError(`Invalid wall time (expected HH:MM): ${s}`);
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    throw new RangeError(`Invalid wall time: ${s}`);
  }
  return h * 60 + min;
}

function isBusy(meeting: Meeting): boolean {
  if (meeting.allDay) return false;
  if (meeting.status !== "confirmed") return false;
  if (meeting.selfResponse === "declined") return false;
  return true;
}

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

  for (let index = 0; index < i.workWeek.length; index += 1) {
    const date = addLocalDays(weekStart, index);

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
