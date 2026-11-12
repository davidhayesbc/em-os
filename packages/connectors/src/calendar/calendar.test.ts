import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Meeting } from "@emos/api-contract";
import type { Clock, Store } from "@emos/core";
import { createStore, openDb } from "@emos/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calendarConnector, createAppliers, fixtureInvoker } from "../index.js";
import { runSync } from "../runtime/orchestrator.js";
import type { ConnectorContext } from "../runtime/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "..", "..", "fixtures", "calendar");

const fixedNow = new Date("2026-10-20T12:00:00.000Z");
const fixedClock: Clock = { now: () => fixedNow };
const nullLog = { info: () => {}, warn: () => {}, error: () => {} };

function createSqliteStore() {
  const dir = mkdtempSync(join(tmpdir(), "emos-calendar-test-"));
  const file = join(dir, "emos.db");
  const db = openDb(file);
  const store = createStore(db);
  return {
    db,
    store,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seededStore(displayZone = "America/Vancouver") {
  const { db, store, cleanup } = createSqliteStore();
  const self = store.people.create({
    displayName: "Alex Rivera",
    relationship: "self",
    pronouns: null,
    aliases: [],
    role: null,
    timeZone: displayZone,
    archived: false,
    oneOnOneCadenceDays: null,
    occurredAt: fixedNow.toISOString(),
  });
  const sam = store.people.create({
    displayName: "Sam Chen",
    relationship: "direct_report",
    pronouns: null,
    aliases: [],
    role: null,
    timeZone: null,
    archived: false,
    oneOnOneCadenceDays: null,
    occurredAt: fixedNow.toISOString(),
  });
  store.people.addIdentity({
    personId: self.id,
    source: "email",
    handle: "alex@example.com",
    confirmed: true,
  });
  store.people.addIdentity({
    personId: sam.id,
    source: "email",
    handle: "sam@example.com",
    confirmed: true,
  });

  const profile = store.settings.getProfile();
  store.settings.setProfile({
    ...profile,
    selfPersonId: self.id,
    displayTimeZone: displayZone,
  });

  return { db, store, cleanup, selfId: self.id, samId: sam.id };
}

function makeContext(
  config: unknown,
  caps: ConnectorContext<unknown>["caps"],
  store: Store,
): ConnectorContext<unknown> {
  return {
    config,
    caps,
    log: nullLog,
    now: fixedClock.now,
    store,
  };
}

function eventsBus() {
  return {
    calls: [] as Array<{ type: string; connectorId: string; state: string }>,
    publish(e: { type: "sync.status"; connectorId: string; state: string }) {
      this.calls.push(e);
    },
  };
}

async function runCalendar(
  ctx: ConnectorContext<unknown>,
  store: Store,
): Promise<{ pages: number; items: number }> {
  return runSync({
    store,
    def: calendarConnector,
    ctx,
    appliers: createAppliers(store),
    events: eventsBus(),
    clock: fixedClock,
  });
}

describe("calendarConnector MCP transport", () => {
  let sqlite: ReturnType<typeof seededStore>;
  beforeEach(() => {
    sqlite = seededStore();
  });
  afterEach(() => sqlite.cleanup());

  it("syncs a two-page fixture into N meetings", async () => {
    const page1 = JSON.parse(
      readFileSync(join(fixtureDir, "events.page1.json"), "utf8"),
    ) as unknown;
    const page2 = JSON.parse(
      readFileSync(join(fixtureDir, "events.page2.json"), "utf8"),
    ) as unknown;
    const caps = fixtureInvoker({ "calendar.listEvents": [page1, page2] });
    const ctx = makeContext(
      { transport: "mcp", server: "example-server", preset: "example-calendar" },
      caps,
      sqlite.store,
    );

    const result = await runCalendar(ctx, sqlite.store);
    expect(result).toEqual({ pages: 2, items: 4 });

    const meetings = sqlite.store.meetings.listRange(
      "2026-10-13T12:00:00.000Z",
      "2026-11-03T12:00:00.000Z",
      { includeCancelled: true },
    );
    expect(meetings).toHaveLength(4);
    expect(meetings.map((m) => m.externalId).sort()).toEqual(["evt-1", "evt-2", "evt-3", "evt-4"]);
  });

  it("produces no duplicates on re-sync", async () => {
    const page1 = JSON.parse(
      readFileSync(join(fixtureDir, "events.page1.json"), "utf8"),
    ) as unknown;
    const page2 = JSON.parse(
      readFileSync(join(fixtureDir, "events.page2.json"), "utf8"),
    ) as unknown;

    const run = async () => {
      const caps = fixtureInvoker({ "calendar.listEvents": [page1, page2] });
      const ctx = makeContext(
        { transport: "mcp", server: "example-server", preset: "example-calendar" },
        caps,
        sqlite.store,
      );
      return runCalendar(ctx, sqlite.store);
    };
    await run();
    await run();

    const meetings = sqlite.store.meetings.listRange(
      "2026-10-13T12:00:00.000Z",
      "2026-11-03T12:00:00.000Z",
      { includeCancelled: true },
    );
    expect(meetings).toHaveLength(4);
  });

  it("marks a cancelled event as cancelled", async () => {
    const page1 = JSON.parse(readFileSync(join(fixtureDir, "events.page1.json"), "utf8")) as {
      items: unknown[];
      nextCursor: string | null;
    };
    const caps = fixtureInvoker({ "calendar.listEvents": [{ ...page1, nextCursor: null }] });
    const ctx = makeContext(
      { transport: "mcp", server: "example-server", preset: "example-calendar" },
      caps,
      sqlite.store,
    );

    await runCalendar(ctx, sqlite.store);

    const meeting = sqlite.store.meetings.listRange(
      "2026-10-21T00:00:00.000Z",
      "2026-10-22T00:00:00.000Z",
      { includeCancelled: true },
    )[0];
    expect(meeting?.status).toBe("cancelled");
  });

  it("sets personId for attendees matching an identity and classifies 1:1s", async () => {
    const page2 = JSON.parse(readFileSync(join(fixtureDir, "events.page2.json"), "utf8")) as {
      items: unknown[];
      nextCursor: string | null;
    };
    const caps = fixtureInvoker({ "calendar.listEvents": [page2] });
    const ctx = makeContext(
      { transport: "mcp", server: "example-server", preset: "example-calendar" },
      caps,
      sqlite.store,
    );

    await runCalendar(ctx, sqlite.store);

    const meeting = sqlite.store.meetings.listRange(
      "2026-10-23T00:00:00.000Z",
      "2026-10-24T00:00:00.000Z",
    )[0] as Meeting;
    expect(meeting.classification).toBe("one_on_one");
    expect(meeting.personId).toBe(sqlite.samId);
    const samAttendee = meeting.attendees.find((a) => a.email === "sam@example.com");
    expect(samAttendee?.personId).toBe(sqlite.samId);
  });

  it("maps self responseStatus to selfResponse", async () => {
    const page1 = JSON.parse(readFileSync(join(fixtureDir, "events.page1.json"), "utf8")) as {
      items: unknown[];
      nextCursor: string | null;
    };
    const caps = fixtureInvoker({ "calendar.listEvents": [{ ...page1, nextCursor: null }] });
    const ctx = makeContext(
      { transport: "mcp", server: "example-server", preset: "example-calendar" },
      caps,
      sqlite.store,
    );

    await runCalendar(ctx, sqlite.store);

    const meeting = sqlite.store.meetings.listRange(
      "2026-10-21T00:00:00.000Z",
      "2026-10-22T00:00:00.000Z",
      { includeCancelled: true },
    )[0] as Meeting;
    expect(meeting.selfResponse).toBe("accepted");
  });
});

describe("calendarConnector ICS transport", () => {
  let sqlite: ReturnType<typeof seededStore>;
  beforeEach(() => {
    sqlite = seededStore();
  });
  afterEach(() => sqlite.cleanup());

  it("expands a weekly RRULE into 3 instances in the window", async () => {
    const ctx = makeContext(
      { transport: "ics", filePath: join(fixtureDir, "sample.ics") },
      fixtureInvoker({}),
      sqlite.store,
    );

    const result = await runCalendar(ctx, sqlite.store);
    expect(result).toEqual({ pages: 1, items: 5 });

    const weekly = sqlite.store.meetings
      .listRange("2026-10-13T12:00:00.000Z", "2026-11-03T12:00:00.000Z")
      .filter((m) => m.title === "Weekly sync");
    expect(weekly).toHaveLength(3);
    expect(weekly.map((m) => m.start)).toEqual([
      "2026-10-14T14:00:00.000Z",
      "2026-10-21T14:00:00.000Z",
      "2026-10-28T14:00:00.000Z",
    ]);
  });

  it("converts a timed TZID=America/New_York event to the correct UTC", async () => {
    const ctx = makeContext(
      { transport: "ics", filePath: join(fixtureDir, "sample.ics") },
      fixtureInvoker({}),
      sqlite.store,
    );

    await runCalendar(ctx, sqlite.store);

    const meeting = sqlite.store.meetings
      .listRange("2026-10-20T00:00:00.000Z", "2026-10-21T00:00:00.000Z")
      .find((m) => m.title === "Timed New York meeting") as Meeting;
    expect(meeting.start).toBe("2026-10-20T13:00:00.000Z");
    expect(meeting.end).toBe("2026-10-20T14:00:00.000Z");
    expect(meeting.allDay).toBe(false);
  });

  it("converts an all-day event with the pinned UTC convention", async () => {
    const ctx = makeContext(
      { transport: "ics", filePath: join(fixtureDir, "sample.ics") },
      fixtureInvoker({}),
      sqlite.store,
    );

    await runCalendar(ctx, sqlite.store);

    const meeting = sqlite.store.meetings
      .listRange("2026-10-23T00:00:00.000Z", "2026-10-24T00:00:00.000Z")
      .find((m) => m.title === "All-hands offsite") as Meeting;
    expect(meeting.allDay).toBe(true);
    expect(meeting.start).toBe("2026-10-23T07:00:00.000Z");
    expect(meeting.end).toBe("2026-10-24T07:00:00.000Z");
  });
});
