import type { Store } from "@emos/core";
import type { Db } from "./driver.js";
import { createAccomplishmentsRepo } from "./repos/accomplishments.js";
import { createCommitmentsRepo } from "./repos/commitments.js";
import { createGoalsRepo } from "./repos/goals.js";
import { createPeopleRepo } from "./repos/people.js";
import { createSettingsRepo } from "./repos/settings.js";

/**
 * The `Store` port (@emos/core) over SQLite. APPEND-ONLY: each Phase 1 slice adds one line
 * registering its repo, e.g. `people: createPeopleRepo(db),` (from `./repos/people.js`).
 */
export function createStore(db: Db): Store {
  return {
    transaction: <T>(fn: () => T): T => db.transaction(fn),
    commitments: createCommitmentsRepo(db),
    goals: createGoalsRepo(db),
    accomplishments: createAccomplishmentsRepo(db),
    settings: createSettingsRepo(db),
    people: createPeopleRepo(db),
  };
}
