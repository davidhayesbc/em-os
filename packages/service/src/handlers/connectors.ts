import { ApiError, type ConnectorRunState } from "@emos/api-contract";
import { ConnectorError, SchedulerConflict, SchedulerNotFound } from "@emos/connectors";
import {
  clearConnectorSecrets,
  readConnectorConfigs,
  writeConnectorConfig,
} from "../connectors/config.js";
import type { Handler } from "../context.js";

function findRegistryEntry(ctx: Parameters<Handler<"connectors.list">>[0], id: string) {
  return ctx.registry.find((r) => r.def.id === id);
}

export const connectorsList: Handler<"connectors.list"> = (ctx) => {
  const configs = readConnectorConfigs(ctx.db);
  return ctx.registry.map((entry) => {
    const state = ctx.store.syncState.get(entry.def.id);
    const stored = configs[entry.def.id];
    return {
      id: entry.def.id,
      kind: entry.def.kind,
      enabled: stored?.enabled ?? false,
      state: state.state as ConnectorRunState,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
    };
  });
};

export const connectorsSync: Handler<"connectors.sync"> = async (ctx, { id }) => {
  const entry = findRegistryEntry(ctx, id);
  if (!entry) throw new ApiError("not_found", `Connector ${id} not found`);
  try {
    return await ctx.scheduler.sync(id);
  } catch (e) {
    if (e instanceof SchedulerConflict) throw new ApiError("conflict", e.message);
    if (e instanceof SchedulerNotFound) throw new ApiError("not_found", e.message);
    if (e instanceof ConnectorError) {
      const initial = ctx.store.syncState.get(id);
      const now = ctx.clock.now().toISOString();
      ctx.store.syncState.set({
        connectorId: id,
        cursor: initial.cursor,
        state: "error" as ConnectorRunState,
        lastAttemptAt: now,
        lastSuccessAt: initial.lastSuccessAt,
        lastError: e.message,
        itemCount: initial.itemCount,
      });
      try {
        ctx.events.publish({ type: "sync.status", connectorId: id, state: "error" });
      } catch {
        // A throwing subscriber must not abort the error transition.
      }
      return { pages: 0, items: 0 };
    }
    throw e;
  }
};

export const connectorsConfigure: Handler<"connectors.configure"> = async (
  ctx,
  { id, enabled, config },
) => {
  const entry = findRegistryEntry(ctx, id);
  if (!entry) throw new ApiError("not_found", `Connector ${id} not found`);
  const parsed = entry.def.configSchema.safeParse(config);
  if (!parsed.success) {
    throw new ApiError("invalid_input", `Invalid config for ${id}`);
  }
  await writeConnectorConfig(ctx.db, ctx.secrets, id, { enabled, config: parsed.data });
  return {};
};

export const connectorsRemove: Handler<"connectors.remove"> = async (ctx, { id }) => {
  const entry = findRegistryEntry(ctx, id);
  if (!entry) throw new ApiError("not_found", `Connector ${id} not found`);
  await clearConnectorSecrets(ctx.db, ctx.secrets, id);
  return {};
};
