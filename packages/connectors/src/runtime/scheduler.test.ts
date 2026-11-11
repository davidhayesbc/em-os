import type { Clock, Logger } from "@emos/core";
import { describe, expect, it } from "vitest";
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
});
