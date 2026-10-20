// Canonical instant format for storage. Every timestamp column in the schema has
// CHECK (x GLOB '????-??-??T??:??:??.???Z'), so repos MUST pass instants through toDbInstant.
// One fixed width keeps lexical order equal to time order, which the occurred_at indexes rely on.

const HAS_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * `new Date(x).toISOString()`: UTC, millisecond precision, trailing `Z`
 * (e.g. `2026-10-20T16:00:00Z` → `2026-10-20T16:00:00.000Z`).
 * Throws RangeError for invalid input, and for strings without `Z` or an offset: JS would read
 * those in the host's local zone, so the result would depend on the machine.
 */
export function toDbInstant(x: string | Date): string {
  if (typeof x === "string" && !HAS_ZONE.test(x)) {
    throw new RangeError(`Not an ISO-8601 instant with a zone: "${x}"`);
  }
  const d = typeof x === "string" ? new Date(x) : x;
  if (Number.isNaN(d.getTime())) throw new RangeError(`Invalid instant: "${String(x)}"`);
  return d.toISOString();
}
