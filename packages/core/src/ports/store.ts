/**
 * Persistence port. Synchronous API. Later slices append their repository
 * fields to this interface; keep this file append-only.
 */
import type { SettingsRepo } from "./repos/settings.js";

export interface Store {
  transaction<T>(fn: () => T): T;
  commitments: import("./repos/commitments.js").CommitmentsRepo;
  goals: import("./repos/goals.js").GoalsRepo;
  accomplishments: import("./repos/accomplishments.js").AccomplishmentsRepo;
  settings: SettingsRepo;
  people: import("./repos/people.js").PeopleRepo;
}
