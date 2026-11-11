import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExternalMeeting } from "@emos/api-contract";
import type { Clock, Store } from "@emos/core";
import { createStore, type Db, openDb } from "@emos/store-sqlite";
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

function createSqliteStore() {
  const dir = mkdtempSync(join(tmpdir(), "emos-orch-test-"));
  const file = join(dir, "emos.db");
  let db: Db = openDb(file);

  return {
    get db() {
      return db;
    },
    get store(): Store {
      return createStore(db);
    },
    get file() {
      return file;
    },
    recreate(): Store {
      db.close();
      db = openDb(file);
      return createStore(db);
    },
    cleanup() {
      try {
        db.close();
      } catch {
        // ignore double-close
      }
      rmSync(dir, { recursive: true, force: true });
    },
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
  let _db: Db;
  let store: Store;
  let sqlite: ReturnType<typeof createSqliteStore>;
  let events: {
    calls: { type: string; connectorId: string; state: string }[];
    publish(e: { type: "sync.status"; connectorId: string; state: string }): void;
  };

  beforeEach(() => {
    sqlite = createSqliteStore();
    _db = sqlite.db;
    store = sqlite.store;
    events = {
      calls: [],
      publish(e) {
        this.calls.push(e);
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    sqlite.cleanup();
  });

  it("persists the advanced cursor inside the page transaction", async () => {
    let unblock: (() => void) | undefined;
    const blocker = new Promise<void>((r) => {
      unblock = r;
    });

    const def: ConnectorDefinition<unknown> = {
      id: "test",
      kind: "calendar",
      configSchema: emptyConfigSchema,
      requiredCapabilities: [],
      defaultIntervalMinutes: 15,
      async *sync() {
        yield { items: [{ entity: "meeting", data: makeMeeting("a") }], nextCursor: "c1" };
        await blocker;
        yield { items: [{ entity: "meeting", data: makeMeeting("b") }], nextCursor: null };
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

    // Wait for the first page to commit before page 2 resolves.
    await vi.waitFor(() => {
      const state = store.syncState.get("test");
      if (state.cursor !== "c1") throw new Error("cursor not committed yet");
    });

    const midState = store.syncState.get("test");
    expect(midState.cursor).toBe("c1");
    expect(midState.state).toBe("syncing");
    expect(midState.itemCount).toBe(1);

    const midMeetings = store.meetings.listRange(
      "2026-10-19T00:00:00.000Z",
      "2026-10-21T00:00:00.000Z",
    );
    expect(midMeetings.map((m) => m.externalId)).toEqual(["a"]);

    unblock?.();
    const result = await promise;
    expect(result).toEqual({ pages: 2, items: 2 });
    expect(store.syncState.get("test").state).toBe("ok");
  });

  it("cursor survives reopening the database after a successful run", async () => {
    const def = createTestConnector([
      { items: [{ entity: "meeting", data: makeMeeting("a") }], nextCursor: "c1" },
      { items: [{ entity: "meeting", data: makeMeeting("b") }], nextCursor: "c2" },
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
    expect(store.syncState.get("test").cursor).toBe("c2");
    expect(store.syncState.get("test").state).toBe("ok");

    const reopened = sqlite.recreate();
    const persisted = reopened.syncState.get("test");
    expect(persisted.cursor).toBe("c2");
    expect(persisted.itemCount).toBe(2);
  });

  it("applies two pages and advances the cursor", async () => {
    const def = createTestConnector([
      { items: [{ entity: "meeting", data: makeMeeting("a") }], nextCursor: "page2" },
      { items: [{ entity: "meeting", data: makeMeeting("b") }], nextCursor: "c2" },
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
    expect(store.syncState.get("test").cursor).toBe("c2");
    expect(store.syncState.get("test").state).toBe("ok");
    expect(store.syncState.get("test").itemCount).toBe(2);
    expect(events.calls.filter((e) => e.state === "ok").length).toBe(1);
  });

  it("rolls back a failing page and leaves the cursor at the last committed page", async () => {
    const def = createTestConnector([
      { items: [{ entity: "meeting", data: makeMeeting("a") }], nextCursor: "c1" },
      {
        items: [
          { entity: "meeting", data: makeMeeting("p1") },
          { entity: "meeting", data: makeMeeting("p2") },
        ],
        nextCursor: "c2",
      },
    ]);
    const failingAppliers = {
      meeting: (m: ExternalMeeting) => {
        if (m.externalId === "p2") throw new ConnectorError("schema", "bad meeting");
        store.meetings.upsertExternal(m);
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

    const persisted = store.syncState.get("test");
    expect(result).toEqual({ pages: 1, items: 1 });
    expect(persisted.cursor).toBe("c1");
    expect(persisted.state).toBe("error");
    expect(persisted.lastError).toBe("bad meeting");
    expect(persisted.itemCount).toBe(1);

    const meetings = store.meetings.listRange(
      "2026-10-19T00:00:00.000Z",
      "2026-10-21T00:00:00.000Z",
    );
    expect(meetings.map((m) => m.externalId)).toEqual(["a"]);
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
