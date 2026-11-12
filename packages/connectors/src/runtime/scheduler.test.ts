import type { Clock, Logger } from "@emos/core";
import { describe, expect, it } from "vitest";
import { ConnectorError } from "./errors.js";
import { fixtureInvoker } from "./fixture-invoker.js";
import { createScheduler, SchedulerConflict } from "./scheduler.js";
import type { ConnectorDefinition } from "./types.js";

const clock: Clock = { now: () => new Date("2026-10-20T12:00:00.000Z") };
const nullLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

describe("createScheduler", () => {
  it("sync returns conflict when the same connector is already running", async () => {
    const def: ConnectorDefinition<unknown> = {
      id: "slow",
      kind: "calendar",
      configSchema: (await import("zod")).z.object({}),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        await new Promise((r) => setTimeout(r, 50));
        yield { items: [], nextCursor: null };
      },
    };
    let runs = 0;
    const scheduler = createScheduler({
      registry: [def],
      createInvoker: () => fixtureInvoker({}),
      getConfig: () => ({ enabled: true, config: {} }),
      runSync: async () => {
        runs++;
        return { pages: 1, items: 0 };
      },
      clock,
      log: nullLog,
    });

    const first = scheduler.sync("slow");
    const second = scheduler.sync("slow");
    await expect(first).resolves.toEqual({ pages: 1, items: 0 });
    await expect(second).rejects.toBeInstanceOf(SchedulerConflict);
    expect(runs).toBe(1);
  });

  it("awaits prepareConfig before createInvoker and passes the prepared config to runSync", async () => {
    const def: ConnectorDefinition<unknown> = {
      id: "prep",
      kind: "calendar",
      configSchema: (await import("zod")).z.object({}),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    const order: string[] = [];
    let capturedConfig: unknown;
    const scheduler = createScheduler({
      registry: [def],
      prepareConfig: async (_id, config) => {
        order.push("prepareConfig");
        return { ...(config as Record<string, unknown>), injected: true };
      },
      createInvoker: (_def, config) => {
        order.push("createInvoker");
        capturedConfig = config;
        return fixtureInvoker({});
      },
      getConfig: () => ({ enabled: true, config: { base: 1 } }),
      runSync: async (_def, ctx) => {
        order.push("runSync");
        capturedConfig = ctx.config;
        return { pages: 1, items: 0 };
      },
      clock,
      log: nullLog,
    });

    await expect(scheduler.sync("prep")).resolves.toEqual({ pages: 1, items: 0 });
    expect(order).toEqual(["prepareConfig", "createInvoker", "runSync"]);
    expect(capturedConfig).toEqual({ base: 1, injected: true });
  });

  it("preserves the original ConnectorError kind when prepareConfig fails", async () => {
    const def: ConnectorDefinition<unknown> = {
      id: "schema-boom",
      kind: "calendar",
      configSchema: (await import("zod")).z.object({}),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    const scheduler = createScheduler({
      registry: [def],
      prepareConfig: async () => {
        throw new ConnectorError("schema", "Bad schema");
      },
      createInvoker: () => fixtureInvoker({}),
      getConfig: () => ({ enabled: true, config: {} }),
      runSync: async () => ({ pages: 1, items: 0 }),
      clock,
      log: nullLog,
    });

    await expect(scheduler.sync("schema-boom")).rejects.toThrow(
      new ConnectorError("schema", "Failed to prepare connector schema-boom: Bad schema"),
    );
  });

  it("rejects a concurrent sync with conflict after prepareConfig resolves", async () => {
    const def: ConnectorDefinition<unknown> = {
      id: "slow-prep",
      kind: "calendar",
      configSchema: (await import("zod")).z.object({}),
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [], nextCursor: null };
      },
    };
    let resolveDeferred: (() => void) | undefined;
    const deferred = new Promise<void>((r) => {
      resolveDeferred = r;
    });
    let runs = 0;
    const scheduler = createScheduler({
      registry: [def],
      prepareConfig: async () => {
        await deferred;
        return {};
      },
      createInvoker: () => fixtureInvoker({}),
      getConfig: () => ({ enabled: true, config: {} }),
      runSync: async () => {
        runs++;
        return { pages: 1, items: 0 };
      },
      clock,
      log: nullLog,
    });

    const first = scheduler.sync("slow-prep");
    const second = scheduler.sync("slow-prep");

    // Both calls are blocked inside the same prepareConfig; release them now.
    resolveDeferred?.();

    await expect(first).resolves.toEqual({ pages: 1, items: 0 });
    await expect(second).rejects.toBeInstanceOf(SchedulerConflict);
    expect(runs).toBe(1);
  });
});
