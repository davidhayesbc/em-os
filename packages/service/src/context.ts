import { randomBytes } from "node:crypto";
import type { OpName, OpOutput, OpParsedInput } from "@emos/api-contract";
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
import type { EventBus } from "./events.js";

export interface ServiceContext {
  db: Db;
  store: Store;
  clock: Clock;
  ids: IdGen;
  log: Logger;
  secrets: SecretStore;
  events: EventBus;
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
  requestShutdown(): void;
}): ServiceContext {
  const db = openDb(deps.config.layout.dbFile, { backupsDir: deps.config.layout.backupsDir });
  return {
    ...deps,
    db,
    store: createStore(db),
    ids: createUlidIdGen(deps.clock, (n) => randomBytes(n)),
  };
}
