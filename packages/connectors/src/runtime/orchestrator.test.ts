import type { ExternalMeeting, Meeting, NewSourceItem, SourceItem } from "@emos/api-contract";
import type { Clock, Store, SyncStateRepo } from "@emos/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAppliers } from "./appliers.js";
import { ConnectorError } from "./errors.js";
import { fixtureInvoker } from "./fixture-invoker.js";
import { runSync } from "./orchestrator.js";
import type { ConnectorContext, ConnectorDefinition } from "./types.js";

const nowIso = "2026-10-20T12:00:00.000Z";
const fixedClock: Clock = { now: () => new Date(nowIso) };

function makeMeeting(externalId: string): ExternalMeeting {
  return {
    connectorId: "test",
    externalId,
    title: `Meeting ${externalId}`,
    start: "2026-10-20T13:00:00.000Z",
    end: "2026-10-20T14:00:00.000Z",
    allDay: false,
    status: "confirmed",
    selfResponse: null,
    classification: "other",
    classificationSource: "auto",
    personId: null,
    attendees: [],
    actionItems: [],
    url: null,
    occurredAt: "2026-10-20T13:00:00.000Z",
  };
}

function createMemoryStore(): Store {
  const syncState: Record<string, import("@emos/core").SyncState> = {};
  const meetings: ExternalMeeting[] = [];
  const sourceItems: NewSourceItem[] = [];

  const repo: SyncStateRepo = {
    get(id) {
      return (
        syncState[id] ?? {
          connectorId: id,
          cursor: null,
          state: "never",
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastError: null,
          itemCount: 0,
        }
      );
    },
    set(s) {
      syncState[s.connectorId] = { ...s };
    },
  };

  return {
    transaction: <T>(fn: () => T): T => fn(),
    syncState: repo,
    meetings: {
      upsertExternal(m) {
        meetings.push(m);
        return { meeting: m as Meeting, created: true };
      },
      get: () => null,
      listRange: () => [],
      update: () => {
        throw new Error("not implemented");
      },
      attachNote: () => {},
      notes: () => [],
      previousOf: () => null,
    },
    sourceItems: {
      upsert(i) {
        sourceItems.push(i);
        return { item: i as SourceItem, created: true };
      },
      get: () => null,
      byIds: () => [],
    },
    accomplishments: {} as Store["accomplishments"],
    commitments: {} as Store["commitments"],
    goals: {} as Store["goals"],
    people: {} as Store["people"],
    settings: {} as Store["settings"],
  };
}

const emptyConfigSchema = z.object({});

function createTestConnector(
  pages: { items: { entity: "meeting"; data: ExternalMeeting }[]; nextCursor: string | null }[],
): ConnectorDefinition<unknown> {
  return {
    id: "test",
    kind: "calendar",
    configSchema: emptyConfigSchema,
    requiredCapabilities: [],
    defaultIntervalMinutes: 15,
    async *sync() {
      for (const page of pages) yield page;
    },
  };
}

function emptyContext(config: unknown = {}): ConnectorContext<unknown> {
  return {
    config,
    caps: fixtureInvoker({}),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    now: fixedClock.now,
  };
}

describe("runSync orchestration", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let events: {
    calls: { type: string; connectorId: string; state: string }[];
    publish(e: { type: "sync.status"; connectorId: string; state: string }): void;
  };

  beforeEach(() => {
    store = createMemoryStore();
    events = {
      calls: [],
      publish(e) {
        this.calls.push(e);
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies two pages and advances the cursor", async () => {
    const def = createTestConnector([
      { items: [{ entity: "meeting", data: makeMeeting("a") }], nextCursor: "page2" },
      { items: [{ entity: "meeting", data: makeMeeting("b") }], nextCursor: null },
    ]);

    const result = await runSync({
      store,
      def,
      ctx: emptyContext(),
      appliers: createAppliers(store),
      events,
      clock: fixedClock,
    });

    expect(result).toEqual({ pages: 2, items: 2 });
    expect(store.syncState.get("test").cursor).toBe(null);
    expect(store.syncState.get("test").state).toBe("ok");
    expect(store.syncState.get("test").itemCount).toBe(2);
    expect(events.calls.filter((e) => e.state === "ok").length).toBe(1);
  });

  it("keeps page 1 and leaves the cursor at page 1 when applier throws on page 2", async () => {
    const def = createTestConnector([
      { items: [{ entity: "meeting", data: makeMeeting("a") }], nextCursor: "page2" },
      { items: [{ entity: "meeting", data: makeMeeting("b") }], nextCursor: null },
    ]);
    const applied: string[] = [];
    const failingAppliers = {
      meeting: (m: ExternalMeeting) => {
        if (m.externalId === "b") throw new ConnectorError("schema", "bad meeting");
        store.meetings.upsertExternal(m);
        applied.push(m.externalId);
      },
      sourceItem: () => {},
    };

    const result = await runSync({
      store,
      def,
      ctx: emptyContext(),
      appliers: failingAppliers,
      events,
      clock: fixedClock,
    });

    expect(applied).toEqual(["a"]);
    expect(result).toEqual({ pages: 1, items: 1 });
    expect(store.syncState.get("test").cursor).toBe("page2");
    expect(store.syncState.get("test").state).toBe("error");
    expect(store.syncState.get("test").lastError).toBe("bad meeting");
  });

  it("retries transient errors twice then succeeds with three attempts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let attempts = 0;
    const def: ConnectorDefinition<unknown> = {
      id: "test",
      kind: "calendar",
      configSchema: emptyConfigSchema,
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        attempts++;
        if (attempts < 3) {
          throw new ConnectorError("transient", `attempt ${attempts}`);
        }
        yield { items: [{ entity: "meeting", data: makeMeeting("ok") }], nextCursor: null };
      },
    };

    const promise = runSync({
      store,
      def,
      ctx: emptyContext(),
      appliers: createAppliers(store),
      events,
      clock: fixedClock,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await promise;

    expect(attempts).toBe(3);
    expect(result).toEqual({ pages: 1, items: 1 });
    expect(store.syncState.get("test").state).toBe("ok");
  });

  it("does not retry auth errors and marks state error", async () => {
    let attempts = 0;
    const def: ConnectorDefinition<unknown> = {
      id: "test",
      kind: "calendar",
      configSchema: emptyConfigSchema,
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      // biome-ignore lint/correctness/useYield: test fixture throws before yielding
      async *sync() {
        attempts++;
        throw new ConnectorError("auth", "unauthorized");
      },
    };

    const result = await runSync({
      store,
      def,
      ctx: emptyContext(),
      appliers: createAppliers(store),
      events,
      clock: fixedClock,
    });

    expect(attempts).toBe(1);
    expect(result).toEqual({ pages: 0, items: 0 });
    expect(store.syncState.get("test").state).toBe("error");
  });

  it("marks ENOTFOUND as offline with the VPN hint after one attempt", async () => {
    let attempts = 0;
    const def: ConnectorDefinition<unknown> = {
      id: "test",
      kind: "calendar",
      configSchema: emptyConfigSchema,
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      // biome-ignore lint/correctness/useYield: test fixture throws before yielding
      async *sync() {
        attempts++;
        const err = new Error("getaddrinfo ENOTFOUND cal.example.com") as Error & { code: string };
        err.code = "ENOTFOUND";
        throw err;
      },
    };

    const result = await runSync({
      store,
      def,
      ctx: emptyContext(),
      appliers: createAppliers(store),
      events,
      clock: fixedClock,
    });

    expect(attempts).toBe(1);
    expect(result).toEqual({ pages: 0, items: 0 });
    expect(store.syncState.get("test").state).toBe("offline");
    expect(store.syncState.get("test").lastError).toBe(
      "Can't reach cal.example.com — check your network or VPN",
    );
  });
});
