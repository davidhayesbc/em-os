import { randomBytes } from "node:crypto";
import type { OpName, OpOutput, OpParsedInput } from "@emos/api-contract";
import { createAppliers, createScheduler, runSync, type Scheduler } from "@emos/connectors";
import {
  type Clock,
  createUlidIdGen,
  type IdGen,
  type Logger,
  type SecretStore,
  type Store,
} from "@emos/core";
import { createStore, type Db, openDb } from "@emos/store-sqlite";
import type { ServiceConfig } from "./config.js";
import { readConnectorConfigs, restoreSecrets } from "./connectors/config.js";
import { connectorRegistry, type RegistryEntry } from "./connectors/registry.js";
import type { EventBus } from "./events.js";

export interface ServiceContext {
  db: Db;
  store: Store;
  clock: Clock;
  ids: IdGen;
  log: Logger;
  secrets: SecretStore;
  events: EventBus;
  scheduler: Scheduler;
  registry: RegistryEntry[];
  config: ServiceConfig;
  /** Stop gracefully once the current response has been sent (`service.shutdown`). */
  requestShutdown(): void;
}

export type Handler<N extends OpName> = (
  ctx: ServiceContext,
  input: OpParsedInput<N>,
) => OpOutput<N> | Promise<OpOutput<N>>;

/**
 * Opens the database (migrating it) and assembles the context. The caller has already checked
 * that `config.dataDir` is not inside a git checkout, and owns `ctx.db.close()`.
 */
export function createContext(deps: {
  config: ServiceConfig;
  clock: Clock;
  log: Logger;
  secrets: SecretStore;
  events: EventBus;
  registry?: RegistryEntry[];
  requestShutdown(): void;
}): ServiceContext {
  const db = openDb(deps.config.layout.dbFile, { backupsDir: deps.config.layout.backupsDir });
  const store = createStore(db);
  const registry = deps.registry ?? connectorRegistry;

  function connectorConfig(id: string): { enabled: boolean; config: unknown } | undefined {
    return readConnectorConfigs(db)[id];
  }

  const appliers = createAppliers(store);
  const scheduler = createScheduler({
    registry: registry.map((r) => r.def),
    createInvoker: (def) => {
      const entry = registry.find((r) => r.def.id === def.id);
      const stored = connectorConfig(def.id);
      if (!entry) {
        throw new Error(`No invoker registered for ${def.id}`);
      }
      return entry.createInvoker((stored?.config ?? {}) as Record<string, unknown>);
    },
    getConfig: (id) => connectorConfig(id),
    runSync: async (def, ctx) => {
      const stored = connectorConfig(def.id);
      const config =
        typeof stored?.config === "object" && stored.config !== null
          ? await restoreSecrets(deps.secrets, def.id, stored.config as Record<string, unknown>)
          : (stored?.config ?? {});
      return runSync({
        store,
        def,
        ctx: { ...ctx, config },
        appliers,
        events: deps.events,
        clock: deps.clock,
      });
    },
    clock: deps.clock,
    log: deps.log,
  });

  return {
    ...deps,
    db,
    store,
    ids: createUlidIdGen(deps.clock, (n) => randomBytes(n)),
    scheduler,
    registry,
  };
}
