import type { SyncState, SyncStateRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

type Row = Record<string, unknown>;

function mapRow(row: Row): SyncState {
  return {
    connectorId: row.connector_id as string,
    cursor: row.cursor === null ? null : (row.cursor as string),
    state: row.state as SyncState["state"],
    lastAttemptAt: row.last_attempt_at === null ? null : (row.last_attempt_at as string),
    lastSuccessAt: row.last_success_at === null ? null : (row.last_success_at as string),
    lastError: row.last_error === null ? null : (row.last_error as string),
    itemCount: Number(row.item_count),
  };
}

const defaultState: SyncState = {
  connectorId: "",
  cursor: null,
  state: "never",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  itemCount: 0,
};

export function createSyncStateRepo(db: Db): SyncStateRepo {
  const getRow = db.prepare("SELECT * FROM sync_state WHERE connector_id = ?");
  const upsert = db.prepare(
    `INSERT INTO sync_state (connector_id, cursor, state, last_attempt_at, last_success_at, last_error, item_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(connector_id) DO UPDATE SET
       cursor = excluded.cursor,
       state = excluded.state,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       last_error = excluded.last_error,
       item_count = excluded.item_count`,
  );

  return {
    get(connectorId) {
      const row = getRow.get<Row>(connectorId);
      return row ? mapRow(row) : { ...defaultState, connectorId };
    },
    set(state) {
      upsert.run(
        state.connectorId,
        state.cursor,
        state.state,
        state.lastAttemptAt ? toDbInstant(state.lastAttemptAt) : null,
        state.lastSuccessAt ? toDbInstant(state.lastSuccessAt) : null,
        state.lastError,
        state.itemCount,
      );
    },
  };
}
