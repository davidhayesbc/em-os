import { z } from "zod";

/** UTC instant, ISO-8601 with a trailing `Z`. Offsets and local (zone-less) values are rejected. */
// Zod 3: z.string().datetime({ offset: false }). Zod 4: z.iso.datetime() is Z-only by default.
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date (`2026-02-29` is not one): round-trips through a UTC `Date`. */
function isRealDate(s: string): boolean {
  const m = LOCAL_DATE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(0);
  // Setting all fields together avoids Date.UTC's special mapping of years 0-99 to 1900-1999.
  t.setUTCFullYear(y, mo - 1, d);
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * Calendar date, `YYYY-MM-DD`, that exists (no Feb 30). Always paired with a separate IANA
 * time-zone field where it matters.
 */
export const LocalDate = z
  .string()
  .regex(LOCAL_DATE)
  .refine(isRealDate, "Not a real calendar date");
export type LocalDate = z.infer<typeof LocalDate>;

/** Local wall-clock time, 24-hour `HH:MM` (`00:00`–`23:59`). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export type LocalTime = z.infer<typeof LocalTime>;

const zoneCache = new Map<string, boolean>();
const ZONE_CACHE_MAX = 512;

/**
 * True if `Intl` knows `zone` as an IANA time-zone name (`America/Vancouver`, `UTC`). Offset
 * strings such as `+05:00`, which newer runtimes also accept, are not IANA names and are
 * rejected. Answers are cached per string.
 */
export function isValidTimeZone(zone: string): boolean {
  const cached = zoneCache.get(zone);
  if (cached !== undefined) return cached;
  let ok = false;
  if (zone !== "" && !/^[+-]/.test(zone)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (zoneCache.size >= ZONE_CACHE_MAX) zoneCache.clear();
  zoneCache.set(zone, ok);
  return ok;
}

/** IANA time-zone name, checked against the runtime's `Intl` data. */
export const TimeZone = z.string().refine(isValidTimeZone, "Unknown IANA time zone");
export type TimeZone = z.infer<typeof TimeZone>;

export const Sensitivity = z.enum(["normal", "people_sensitive", "private"]);
export type Sensitivity = z.infer<typeof Sensitivity>;

export const RetentionState = z.enum(["active", "archived", "excluded", "purged"]);
export type RetentionState = z.infer<typeof RetentionState>;

/** Fields every entity carries (spec 7.1 and 7.6). */
export const Dated = z.object({
  occurredAt: IsoDateTime,
  capturedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  retentionState: RetentionState,
});
export type Dated = z.infer<typeof Dated>;

/**
 * Creation shape for an entity `X`: everything except `id`, `capturedAt` and `updatedAt`
 * (assigned by the service). `occurredAt` and `retentionState` are optional and default to
 * now and `"active"`.
 */
export type NewEntity<T extends Dated & { id: string }> = Omit<
  T,
  "id" | "capturedAt" | "updatedAt" | "occurredAt" | "retentionState"
> &
  Partial<Pick<T, "occurredAt" | "retentionState">>;
