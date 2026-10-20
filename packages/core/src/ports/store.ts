/**
 * Persistence port. Synchronous API. Later slices append their repository
 * fields to this interface; keep this file append-only.
 */
export interface Store {
  transaction<T>(fn: () => T): T;
}
