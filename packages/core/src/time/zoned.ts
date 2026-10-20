// Zoned date/time helpers built on Intl only (no tz library).
// A "local date" is a `YYYY-MM-DD` string interpreted in an IANA time zone.

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Throws `RangeError` for an unknown time zone (Intl's behaviour). */
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

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Offset (local - UTC) in ms at the given instant, at whole-second resolution. */
function offsetMs(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function parseLocalDate(localDate: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
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

/** The calendar date (`YYYY-MM-DD`) of `instant` in `timeZone`. */
export function toLocalDate(instant: Date, timeZone: string): string {
  const w = wallClock(instant, timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/**
 * The UTC instant of local midnight on `localDate` in `timeZone`.
 *
 * Two-pass offset correction: guess the offset at UTC midnight, apply it, then
 * re-read the offset at the corrected instant (it may differ across a DST edge)
 * and apply that. Assumes midnight exists in the zone; if a zone skips
 * midnight on a DST day the result is the first valid instant after the gap.
 */
export function startOfLocalDay(localDate: string, timeZone: string): Date {
  const { y, m, d } = parseLocalDate(localDate);
  const wall = Date.UTC(y, m - 1, d);
  const firstGuess = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(firstGuess), timeZone));
}

/** Add (or subtract) whole calendar days to a `YYYY-MM-DD` date. Zone-independent. */
export function addLocalDays(localDate: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`days must be an integer: ${days}`);
  const { y, m, d } = parseLocalDate(localDate);
  const out = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(out.getUTCFullYear(), 4)}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())}`;
}

/** Weekday of a `YYYY-MM-DD` date: 0=Sun ... 6=Sat. */
export function localWeekdayIndex(localDate: string): number {
  const { y, m, d } = parseLocalDate(localDate);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Minutes since local midnight (0-1439) for `instant` in `timeZone`. */
export function localMinutes(instant: Date, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return w.hour * 60 + w.minute;
}
