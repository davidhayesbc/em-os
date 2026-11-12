import type { Clock, Store, SyncState } from "@emos/core";
import { ConnectorError } from "./errors.js";
import { classifyError, extractServerName } from "./network.js";
import { redactSecrets, sanitizeLastError } from "./sanitize.js";
import type {
  Appliers,
  ConnectorContext,
  ConnectorDefinition,
  SyncEventBus,
  SyncPage,
} from "./types.js";

export interface RunSyncDeps {
  store: Store;
  def: ConnectorDefinition<unknown>;
  ctx: ConnectorContext<unknown>;
  appliers: Appliers;
  events: SyncEventBus;
  clock: Clock;
  /**
   * Optional async config preparation (e.g. restoring secrets) that runs inside the sync attempt
   * so failures are classified and update sync_state, not returned as RPC internal errors.
   */
  prepareConfig?(config: unknown): Promise<unknown>;
}

const MAX_RETRIES = 2; // 1 initial attempt + 2 retries = 3 attempts max.
const BACKOFF_BASE_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredDelay(attempt: number): number {
  const base = BACKOFF_BASE_MS * 4 ** attempt;
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(base * jitter);
}

function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}

function publishStatus(events: SyncEventBus, connectorId: string, state: string): void {
  try {
    events.publish({ type: "sync.status", connectorId, state });
  } catch {
    // A throwing subscriber must not abort the sync.
  }
}

/** Runs one attempt of the sync loop, mutating `state` with committed progress. */
async function runOnce(
  deps: RunSyncDeps,
  state: { cursor: string | null; pages: number; items: number },
  base: SyncState,
  at: string,
): Promise<void> {
  const { def, ctx, appliers, store } = deps;
  const connectorId = def.id;
  const controller = new AbortController();

  try {
    const prepared = deps.prepareConfig ? await deps.prepareConfig(ctx.config) : ctx.config;
    const ctxWithConfig = { ...ctx, config: prepared };
    for await (const page of def.sync(ctxWithConfig, state.cursor, controller.signal)) {
      const safePage = normalizePage(page);
      store.transaction(() => {
        for (const item of safePage.items) {
          applyItem(appliers, item);
        }
        state.cursor = safePage.nextCursor;
        state.items += safePage.items.length;
        store.syncState.set({
          connectorId,
          cursor: state.cursor,
          state: "syncing",
          lastAttemptAt: at,
          lastSuccessAt: base.lastSuccessAt,
          lastError: null,
          itemCount: base.itemCount + state.items,
        });
      });
      state.pages++;
    }
  } catch (e) {
    controller.abort();
    throw e;
  }
}

function normalizePage(page: SyncPage): SyncPage {
  return {
    items: page.items ?? [],
    nextCursor: page.nextCursor ?? null,
  };
}

function applyItem(appliers: Appliers, item: { entity: string; data: unknown }): void {
  if (item.entity === "meeting") {
    appliers.meeting(item.data as Parameters<Appliers["meeting"]>[0]);
    return;
  }
  if (item.entity === "source_item") {
    appliers.sourceItem(item.data as Parameters<Appliers["sourceItem"]>[0]);
    return;
  }
  throw new ConnectorError("schema", `Unknown connector item entity: ${item.entity}`);
}

function finalizeState(deps: RunSyncDeps, state: SyncStateUpdate): void {
  deps.store.syncState.set(state);
  publishStatus(deps.events, state.connectorId, state.state);
}

type SyncStateUpdate = {
  connectorId: string;
  cursor: string | null;
  state: "syncing" | "ok" | "offline" | "error";
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  itemCount: number;
};

function buildOfflineMessage(error: unknown, defId: string): string {
  const server = extractServerName(error) ?? defId;
  return `Can't reach ${server} — check your network or VPN`;
}

/**
 * Runs a connector sync with transactional pages and retry/backoff.
 *
 * - Each page is applied and its cursor is written in a single store transaction; a thrown
 *   applier rolls back the page and leaves the cursor at the last committed page.
 * - Transient errors retry up to 3 attempts total with exponential backoff.
 * - Auth/permission/schema/config errors set `state: "error"` and never retry.
 * - Offline errors set `state: "offline"` with the VPN hint and never retry within this run.
 */
export async function runSync(deps: RunSyncDeps): Promise<{ pages: number; items: number }> {
  const { store, def, clock, events } = deps;
  const connectorId = def.id;
  const at = nowIso(clock);

  const initial = store.syncState.get(connectorId);
  store.syncState.set({
    ...initial,
    connectorId,
    state: "syncing",
    lastAttemptAt: at,
    lastError: null,
  });
  publishStatus(events, connectorId, "syncing");

  const state = {
    cursor: initial.cursor,
    pages: 0,
    items: 0,
  };
  let lastError: unknown;
  const committedCursor = () => store.syncState.get(connectorId).cursor;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await runOnce(deps, state, initial, at);
      const successState: SyncStateUpdate = {
        connectorId,
        cursor: committedCursor(),
        state: "ok",
        lastAttemptAt: at,
        lastSuccessAt: at,
        lastError: null,
        itemCount: initial.itemCount + state.items,
      };
      finalizeState(deps, successState);
      return { pages: state.pages, items: state.items };
    } catch (e) {
      lastError = e;
      const kind = classifyError(e);

      if (kind === "auth" || kind === "permission" || kind === "schema" || kind === "config") {
        const message = e instanceof Error ? e.message : kind;
        finalizeState(deps, {
          connectorId,
          cursor: committedCursor(),
          state: "error",
          lastAttemptAt: at,
          lastSuccessAt: initial.lastSuccessAt,
          lastError: sanitizeLastError(redactSecrets(message, deps.ctx.config)) || null,
          itemCount: initial.itemCount + state.items,
        });
        return { pages: state.pages, items: state.items };
      }

      if (kind === "offline") {
        const message = buildOfflineMessage(e, def.id);
        finalizeState(deps, {
          connectorId,
          cursor: committedCursor(),
          state: "offline",
          lastAttemptAt: at,
          lastSuccessAt: initial.lastSuccessAt,
          lastError: sanitizeLastError(redactSecrets(message, deps.ctx.config)) || null,
          itemCount: initial.itemCount + state.items,
        });
        return { pages: state.pages, items: state.items };
      }

      // Transient: retry unless we're out of attempts.
      if (attempt < MAX_RETRIES) {
        await sleep(jitteredDelay(attempt));
      }
    }
  }

  // Retries exhausted.
  const exhausted = lastError instanceof Error ? lastError.message : String(lastError);
  finalizeState(deps, {
    connectorId,
    cursor: committedCursor(),
    state: "error",
    lastAttemptAt: at,
    lastSuccessAt: initial.lastSuccessAt,
    lastError: sanitizeLastError(redactSecrets(exhausted, deps.ctx.config)) || null,
    itemCount: initial.itemCount + state.items,
  });
  return { pages: state.pages, items: state.items };
}
