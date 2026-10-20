/** Source of the current instant. Inject a fixed clock in tests. */
export interface Clock {
  now(): Date;
}

/** Wall-clock time. Reading the time is not I/O, so this lives in core. */
export const systemClock: Clock = { now: () => new Date() };

/** A clock frozen at an ISO-8601 instant. Each call returns a fresh `Date`. */
export function fixedClock(iso: string): Clock {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO instant: ${iso}`);
  return { now: () => new Date(ms) };
}
