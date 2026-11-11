import type { Store } from "@emos/core";
import type { Appliers } from "./types.js";

/** Default appliers: meetings go to the meetings repo, source items to source_items. */
export function createAppliers(store: Store): Appliers {
  return {
    meeting(item) {
      store.meetings.upsertExternal(item);
    },
    sourceItem(item) {
      store.sourceItems.upsert(item);
    },
  };
}
