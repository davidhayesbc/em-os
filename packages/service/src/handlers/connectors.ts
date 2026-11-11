import { ApiError, type ConnectorRunState } from "@emos/api-contract";
import { SchedulerConflict, SchedulerNotFound } from "@emos/connectors";
import { readConnectorConfigs, writeConnectorConfig } from "../connectors/config.js";
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
