/**
 * Sync-state persistence for connectors. Keeps the cursor, run state and last-error message
 * (never content) per connector.
 */

export type ConnectorRunState = "never" | "syncing" | "ok" | "offline" | "error";

export interface SyncState {
  connectorId: string;
  cursor: string | null;
  state: ConnectorRunState;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  itemCount: number;
}

export interface SyncStateRepo {
  get(connectorId: string): SyncState;
  set(state: SyncState): void;
}
