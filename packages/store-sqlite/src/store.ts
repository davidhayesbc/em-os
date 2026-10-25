import type { Store } from "@emos/core";
import type { Db } from "./driver.js";
import { createSettingsRepo } from "./repos/settings.js";

/**
 * The `Store` port (@emos/core) over SQLite. APPEND-ONLY: each Phase 1 slice adds one line
 * registering its repo, e.g. `people: createPeopleRepo(db),` (from `./repos/people.js`).
 */
export function createStore(db: Db): Store {
  return {
    transaction: <T>(fn: () => T): T => db.transaction(fn),
    settings: createSettingsRepo(db),
  };
}
