/**
 * Persistence port. Synchronous API. Later slices append their repository
 * fields to this interface; keep this file append-only.
 */
export interface Store {
  transaction<T>(fn: () => T): T;
  commitments: import("./repos/commitments.js").CommitmentsRepo;
  goals: import("./repos/goals.js").GoalsRepo;
  accomplishments: import("./repos/accomplishments.js").AccomplishmentsRepo;
}
