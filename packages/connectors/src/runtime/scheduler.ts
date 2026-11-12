import type { Clock, Logger, Store } from "@emos/core";
import { ConnectorError } from "./errors.js";
import type { CapabilityInvoker, ConnectorContext, ConnectorDefinition } from "./types.js";

export interface SchedulerDeps {
  /** Connector definitions the scheduler may run. */
  registry: ConnectorDefinition<unknown>[];
  /** Build a capability invoker for a configured connector. */
  createInvoker(def: ConnectorDefinition<unknown>, config: unknown): CapabilityInvoker;
  /** Read connector configs (enabled + validated config) from the service. */
  getConfig(id: string): { enabled: boolean; config: unknown } | undefined;
  /**
   * Optional async config preparation (e.g. restoring secrets). When provided it is awaited before
   * the capability invoker is built, so the invoker receives a fully prepared config.
   */
  prepareConfig?(connectorId: string, config: unknown): Promise<unknown>;
  /** Run a sync for a connector; implemented by the service wiring. */
  runSync(
    def: ConnectorDefinition<unknown>,
    ctx: ConnectorContext<unknown>,
  ): Promise<{ pages: number; items: number }>;
  /** Store reference forwarded to connectors that need it (e.g. calendar). */
  store?: Store;
  clock: Clock;
  log: Logger;
}

export interface Scheduler {
  start(): void;
  stop(): Promise<void>;
  /** Trigger an immediate sync. Returns `conflict` if the connector is already running. */
  sync(id: string): Promise<{ pages: number; items: number }>;
}

/**
 * In-process scheduler. Starts one interval per enabled connector and prevents concurrent runs
 * of the same connector. Intervals are overridable per connector via its config (the service
 * layer can store a `intervalMinutes` override).
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { registry, createInvoker, getConfig, prepareConfig, runSync, store, clock, log } = deps;
  const running = new Map<string, Promise<{ pages: number; items: number }>>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  let started = false;

  async function contextFor(def: ConnectorDefinition<unknown>): Promise<ConnectorContext<unknown>> {
    const stored = getConfig(def.id);
    // Unconfigured connectors fall back to {} here; the invoker factory validates/defaults it.
    const rawConfig = stored?.config ?? {};
    try {
      const config = stored && prepareConfig ? await prepareConfig(def.id, rawConfig) : rawConfig;
      const caps = createInvoker(def, config);
      return {
        config,
        caps,
        log,
        now: () => clock.now(),
        store,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const kind = e instanceof ConnectorError ? e.kind : "config";
      throw new ConnectorError(kind, `Failed to prepare connector ${def.id}: ${message}`);
    }
  }

  function intervalMinutes(def: ConnectorDefinition<unknown>): number {
    const stored = getConfig(def.id);
    const override =
      stored &&
      typeof stored.config === "object" &&
      stored.config !== null &&
      "intervalMinutes" in stored.config &&
      typeof (stored.config as { intervalMinutes?: unknown }).intervalMinutes === "number"
        ? (stored.config as { intervalMinutes: number }).intervalMinutes
        : undefined;
    return override ?? def.defaultIntervalMinutes;
  }

  function schedule(def: ConnectorDefinition<unknown>): void {
    if (timers.has(def.id)) return;
    const ms = intervalMinutes(def) * 60 * 1000;
    if (ms <= 0) return;
    const timer = setInterval(() => {
      sync(def.id).catch((e: unknown) => {
        log.error("scheduler.interval_failed", {
          connectorId: def.id,
          errorName: e instanceof Error ? e.name : typeof e,
        });
      });
    }, ms);
    timer.unref?.();
    timers.set(def.id, timer);
  }

  async function sync(id: string): Promise<{ pages: number; items: number }> {
    const existing = running.get(id);
    if (existing) {
      throw new SchedulerConflict(id);
    }
    const def = registry.find((d) => d.id === id);
    if (!def) {
      throw new SchedulerNotFound(id);
    }
    const stored = getConfig(def.id);
    if (stored?.enabled === false) {
      return { pages: 0, items: 0 };
    }

    const ctx = await contextFor(def);
    const stillRunning = running.get(id);
    if (stillRunning) {
      throw new SchedulerConflict(id);
    }
    const promise = runSync(def, ctx).finally(() => {
      running.delete(id);
    });
    running.set(id, promise);
    return promise;
  }

  return {
    start() {
      if (started) return;
      started = true;
      for (const def of registry) {
        const stored = getConfig(def.id);
        if (stored?.enabled) {
          schedule(def);
          // Run once soon after start; don't await so start() stays synchronous.
          sync(def.id).catch((e: unknown) => {
            log.error("scheduler.initial_sync_failed", {
              connectorId: def.id,
              errorName: e instanceof Error ? e.name : typeof e,
            });
          });
        }
      }
    },
    async stop() {
      started = false;
      for (const [id, timer] of timers) {
        clearInterval(timer);
        timers.delete(id);
      }
      // Wait for in-flight runs so we don't close the DB underneath them.
      await Promise.all([...running.values()]);
      running.clear();
    },
    sync,
  };
}

export class SchedulerConflict extends Error {
  constructor(readonly connectorId: string) {
    super(`Connector ${connectorId} is already syncing`);
    this.name = "SchedulerConflict";
  }
}

export class SchedulerNotFound extends Error {
  constructor(readonly connectorId: string) {
    super(`Connector ${connectorId} not found`);
    this.name = "SchedulerNotFound";
  }
}
