import type { LocalDate, Meeting } from "@emos/api-contract";
import { addLocalDays, localMinutes, startOfLocalDay, toLocalDate } from "../time/zoned.js";

export interface Block {
  start: string;
  end: string;
  minutes: number;
}

interface Interval {
  start: number;
  end: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Invalid Date");
  const out: WallClock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of formatterFor(timeZone).formatToParts(instant)) {
    if (p.type in out) out[p.type as keyof WallClock] = Number(p.value);
  }
  return out;
}

/** Offset (local - UTC) in ms at the given instant, at whole-second resolution. */
function offsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLocalDate(localDate: string): { y: number; m: number; d: number } {
  const match = LOCAL_DATE_RE.exec(localDate);
  if (!match) throw new RangeError(`Invalid local date (expected YYYY-MM-DD): ${localDate}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid local date: ${localDate}`);
  }
  return { y, m, d };
}

/**
 * The first UTC instant on `localDate` in `timeZone` when the local wall clock reads
 * `minuteOfDay`. A time inside a DST gap resolves to the first valid instant after the gap.
 */
function localInstant(localDate: string, timeZone: string, minuteOfDay: number): Date {
  const { y, m, d } = parseLocalDate(localDate);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const utcWall = Date.UTC(y, m - 1, d, hour, minute, 0, 0);

  let instant = new Date(utcWall);
  for (let i = 0; i < 6; i += 1) {
    const next = new Date(utcWall - offsetMs(instant, timeZone));
    if (next.getTime() === instant.getTime()) return next;
    instant = next;
  }
  return instant;
}

function parseWallTime(s: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s);
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

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  let current = sorted[0];
  if (!current) return [];
  const merged: Interval[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (!next) continue;
    if (next.start <= current.end) {
      current = { start: current.start, end: Math.max(current.end, next.end) };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

export function freeBlocks(i: {
  localDate: LocalDate;
  timeZone: string;
  workingHours: { start: string; end: string };
  meetings: Meeting[];
  now: Date;
  minMinutes: number;
}): Block[] {
  const zone = i.timeZone;
  const dayStart = startOfLocalDay(i.localDate, zone);
  const nextDay = addLocalDays(i.localDate, 1);
  const dayLength = Math.round(
    (startOfLocalDay(nextDay, zone).getTime() - dayStart.getTime()) / 60000,
  );

  const workStart = parseWallTime(i.workingHours.start);
  const workEnd = parseWallTime(i.workingHours.end);
  if (workEnd <= workStart) {
    throw new RangeError("Working hours end must be after start");
  }

  const busyIntervals: Interval[] = [];
  for (const meeting of i.meetings) {
    if (!isBusy(meeting)) continue;

    const startInstant = new Date(meeting.start);
    const endInstant = new Date(meeting.end);
    const startDate = toLocalDate(startInstant, zone);
    const endDate = toLocalDate(endInstant, zone);

    if (endDate < i.localDate || startDate > i.localDate) continue;

    const startMin = startDate < i.localDate ? 0 : localMinutes(startInstant, zone);
    let endMin = endDate > i.localDate ? dayLength : localMinutes(endInstant, zone);

    // The meeting may be reported in a different order around a DST transition;
    // clamp it to the day and intersect with working hours.
    if (endMin < startMin) {
      endMin = dayLength;
    }

    const clippedStart = Math.max(startMin, workStart);
    const clippedEnd = Math.min(endMin, workEnd);
    if (clippedEnd > clippedStart) {
      busyIntervals.push({ start: clippedStart, end: clippedEnd });
    }
  }

  const merged = mergeIntervals(busyIntervals);

  const isToday = i.localDate === toLocalDate(i.now, zone);
  const nowMin = isToday ? localMinutes(i.now, zone) : Number.NEGATIVE_INFINITY;

  const free: Block[] = [];
  let cursor = workStart;
  for (const busy of merged) {
    if (busy.start > cursor) {
      let blockStart = cursor;
      if (isToday && nowMin > blockStart) {
        blockStart = nowMin;
      }
      const blockEnd = busy.start;
      const minutes = blockEnd - blockStart;
      if (minutes >= i.minMinutes) {
        free.push({
          start: localInstant(i.localDate, zone, blockStart).toISOString(),
          end: localInstant(i.localDate, zone, blockEnd).toISOString(),
          minutes,
        });
      }
    }
    cursor = Math.max(cursor, busy.end);
  }
  if (cursor < workEnd) {
    let blockStart = cursor;
    if (isToday && nowMin > blockStart) {
      blockStart = nowMin;
    }
    const blockEnd = workEnd;
    const minutes = blockEnd - blockStart;
    if (minutes >= i.minMinutes) {
      free.push({
        start: localInstant(i.localDate, zone, blockStart).toISOString(),
        end: localInstant(i.localDate, zone, blockEnd).toISOString(),
        minutes,
      });
    }
  }

  return free;
}
