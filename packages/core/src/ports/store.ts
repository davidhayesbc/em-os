/**
 * Persistence port. Synchronous API. Later slices append their repository
 * fields to this interface; keep this file append-only.
 */
import type { SettingsRepo } from "./repos/settings.js";

export interface Store {
  transaction<T>(fn: () => T): T;
  accomplishments: import("./repos/accomplishments.js").AccomplishmentsRepo;
  commitments: import("./repos/commitments.js").CommitmentsRepo;
  goals: import("./repos/goals.js").GoalsRepo;
  meetings: import("./repos/meetings.js").MeetingsRepo;
  people: import("./repos/people.js").PeopleRepo;
  settings: SettingsRepo;
  sourceItems: import("./repos/source-items.js").SourceItemsRepo;
}
