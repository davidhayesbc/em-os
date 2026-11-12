/**
 * Persistence port. Synchronous API. Later slices append their repository
 * fields to this interface; keep this file append-only.
 */
import type { ImportKeysRepo } from "./repos/import-keys.js";
import type { SettingsRepo } from "./repos/settings.js";
import type { SyncStateRepo } from "./repos/sync-state.js";

export interface Store {
  transaction<T>(fn: () => T): T;
  accomplishments: import("./repos/accomplishments.js").AccomplishmentsRepo;
  commitments: import("./repos/commitments.js").CommitmentsRepo;
  goals: import("./repos/goals.js").GoalsRepo;
  importKeys: ImportKeysRepo;
  meetings: import("./repos/meetings.js").MeetingsRepo;
  people: import("./repos/people.js").PeopleRepo;
  settings: SettingsRepo;
  sourceItems: import("./repos/source-items.js").SourceItemsRepo;
  syncState: SyncStateRepo;
}
