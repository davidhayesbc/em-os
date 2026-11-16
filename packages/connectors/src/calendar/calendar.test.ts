import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Meeting } from "@emos/api-contract";
import type { Clock, Store } from "@emos/core";
import { createStore, openDb } from "@emos/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { calendarConnector, createAppliers, fixtureInvoker } from "../index.js";
import { ConnectorError } from "../runtime/errors.js";
import { runSync } from "../runtime/orchestrator.js";
import type { CapabilityInvoker, ConnectorContext } from "../runtime/types.js";
import { MAX_ICS_FILE_BYTES } from "./ics.js";

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

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "emos-calendar-test-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * A fixture invoker that records every call (capability, args, schema) and returns
 * successive canned responses per capability. Useful for asserting that a sync made
 * exactly the expected invocations.
 */
function recordingFixtureInvoker(responses: Record<string, unknown[]>): CapabilityInvoker & {
  calls: Array<{ capability: string; args: Record<string, unknown>; schema: z.ZodType<unknown> }>;
} {
  const counters: Record<string, number> = {};
  const calls: Array<{
    capability: string;
    args: Record<string, unknown>;
    schema: z.ZodType<unknown>;
  }> = [];

  return {
    calls,
    async call<T>(
      capability: string,
      args: Record<string, unknown>,
      schema: z.ZodType<T>,
    ): Promise<T> {
      calls.push({ capability, args, schema: schema as z.ZodType<unknown> });
      const list = responses[capability];
      if (!list || list.length === 0) {
        throw new ConnectorError("config", `No fixture response for capability ${capability}`);
      }
      const index = counters[capability] ?? 0;
      counters[capability] = index + 1;
      if (index >= list.length) {
        throw new ConnectorError("config", `Fixture responses exhausted for ${capability}`);
      }
      const value = structuredClone(list[index] as T);
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new ConnectorError("schema", `Fixture response for ${capability} failed validation`);
      }
      return parsed.data;
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

  it("starts pagination from null even when a cursor is already persisted", async () => {
    const page1 = JSON.parse(readFileSync(join(fixtureDir, "events.page1.json"), "utf8")) as {
      items: unknown[];
      nextCursor: string | null;
    };
    sqlite.store.syncState.set({
      connectorId: "calendar",
      cursor: "page2",
      state: "ok",
      lastAttemptAt: fixedNow.toISOString(),
      lastSuccessAt: fixedNow.toISOString(),
      lastError: null,
      itemCount: 0,
    });

    const caps = recordingFixtureInvoker({
      "calendar.listEvents": [{ ...page1, nextCursor: null }],
    });
    const ctx = makeContext(
      { transport: "mcp", server: "example-server", preset: "example-calendar" },
      caps,
      sqlite.store,
    );

    const result = await runCalendar(ctx, sqlite.store);

    expect(result).toEqual({ pages: 1, items: 3 });
    expect(caps.calls).toHaveLength(1);
    expect(caps.calls[0]?.args.page).toBeNull();

    const meetings = sqlite.store.meetings.listRange(
      "2026-10-13T12:00:00.000Z",
      "2026-11-03T12:00:00.000Z",
      { includeCancelled: true },
    );
    expect(meetings.map((m) => m.externalId).sort()).toContain("evt-1");
  });

  it("classifies a DTO schema mismatch as a terminal error with one attempt", async () => {
    const badPage = {
      items: [
        {
          externalId: "bad-1",
          title: "Bad event",
          start: "2026-10-20T13:00:00.000Z",
          end: "2026-10-20T14:00:00.000Z",
          allDay: false,
          status: "provisional",
          attendees: [],
          url: null,
          recurringEventId: null,
        },
      ],
      nextCursor: null,
    };
    const caps = recordingFixtureInvoker({ "calendar.listEvents": [badPage] });
    const ctx = makeContext(
      { transport: "mcp", server: "example-server", preset: "example-calendar" },
      caps,
      sqlite.store,
    );

    const result = await runCalendar(ctx, sqlite.store);

    expect(result).toEqual({ pages: 0, items: 0 });
    expect(caps.calls).toHaveLength(1);
    const state = sqlite.store.syncState.get("calendar");
    expect(state.state).toBe("error");
    expect(state.lastError).not.toContain("provisional");
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

  it("classifies a missing ICS file as a terminal config error", async () => {
    const ctx = makeContext(
      { transport: "ics", filePath: join(fixtureDir, "does-not-exist.ics") },
      fixtureInvoker({}),
      sqlite.store,
    );

    const result = await runCalendar(ctx, sqlite.store);

    expect(result).toEqual({ pages: 0, items: 0 });
    const state = sqlite.store.syncState.get("calendar");
    expect(state.state).toBe("error");
    expect(state.lastError).toBe("Calendar ICS file is not readable");
  });

  it("classifies malformed ICS text as a terminal schema error", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "bad.ics");
    writeFileSync(path, "this is not ical data", "utf8");

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      const result = await runCalendar(ctx, sqlite.store);

      expect(result).toEqual({ pages: 0, items: 0 });
      const state = sqlite.store.syncState.get("calendar");
      expect(state.state).toBe("error");
      expect(state.lastError).toBe("Calendar ICS data is malformed");
    } finally {
      cleanup();
    }
  });

  it("classifies a SUMMARY-less VEVENT as a terminal schema error with one attempt", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "no-summary.ics");
    writeFileSync(
      path,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:no-summary-1@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T130000Z",
        "DTEND:20261020T140000Z",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      "utf8",
    );

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      const result = await runCalendar(ctx, sqlite.store);

      expect(result).toEqual({ pages: 0, items: 0 });
      const state = sqlite.store.syncState.get("calendar");
      expect(state.state).toBe("error");
      expect(state.lastError).toBe("Calendar ICS data is malformed");
      expect(state.lastError).not.toContain("NOT NULL");
      expect(state.lastError).not.toContain("meetings.title");

      // No row with a silent undefined title should have been written.
      const meetings = sqlite.store.meetings.listRange(
        "2026-10-20T00:00:00.000Z",
        "2026-10-21T00:00:00.000Z",
        { includeCancelled: true },
      );
      expect(meetings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("rejects a mixed ICS page as schema rather than importing any events", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "mixed.ics");
    writeFileSync(
      path,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:good-1@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T130000Z",
        "DTEND:20261020T140000Z",
        "SUMMARY:Valid event",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:no-summary-2@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T150000Z",
        "DTEND:20261020T160000Z",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      "utf8",
    );

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      const result = await runCalendar(ctx, sqlite.store);

      expect(result).toEqual({ pages: 0, items: 0 });
      const state = sqlite.store.syncState.get("calendar");
      expect(state.state).toBe("error");
      expect(state.lastError).toBe("Calendar ICS data is malformed");

      // The whole page is rolled back, so even the valid event is not imported.
      const meetings = sqlite.store.meetings.listRange(
        "2026-10-20T00:00:00.000Z",
        "2026-10-21T00:00:00.000Z",
        { includeCancelled: true },
      );
      expect(meetings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("resolves self response from an ATTENDEE matching the profile email", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "self-attendee.ics");
    writeFileSync(
      path,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:self-1@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T130000Z",
        "DTEND:20261020T140000Z",
        "SUMMARY:Self attendee meeting",
        "STATUS:CONFIRMED",
        'ATTENDEE;CN="Alex Rivera";PARTSTAT=ACCEPTED:mailto:alex@example.com',
        'ATTENDEE;CN="Sam Chen";PARTSTAT=NEEDS-ACTION:mailto:sam@example.com',
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      "utf8",
    );

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      await runCalendar(ctx, sqlite.store);

      const meeting = sqlite.store.meetings
        .listRange("2026-10-20T00:00:00.000Z", "2026-10-21T00:00:00.000Z")
        .find((m) => m.title === "Self attendee meeting") as Meeting;
      expect(meeting.selfResponse).toBe("accepted");
    } finally {
      cleanup();
    }
  });

  it("rejects a SECONDLY recurrence flood as a terminal schema error with no rows written", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "flood.ics");
    writeFileSync(
      path,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:flood-1@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T120000Z",
        "RRULE:FREQ=SECONDLY;COUNT=1000",
        "SUMMARY:Flood event",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      "utf8",
    );

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      const result = await runCalendar(ctx, sqlite.store);

      expect(result).toEqual({ pages: 0, items: 0 });
      const state = sqlite.store.syncState.get("calendar");
      expect(state.state).toBe("error");
      expect(state.lastError).toBe(
        "Calendar ICS recurrence expansion exceeded the per-event limit",
      );

      const meetings = sqlite.store.meetings.listRange(
        "2026-10-20T00:00:00.000Z",
        "2026-10-21T00:00:00.000Z",
        { includeCancelled: true },
      );
      expect(meetings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("rejects an oversized ICS file as a terminal schema error", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "huge.ics");
    writeFileSync(path, Buffer.alloc(MAX_ICS_FILE_BYTES + 1, "A"));

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      const result = await runCalendar(ctx, sqlite.store);

      expect(result).toEqual({ pages: 0, items: 0 });
      const state = sqlite.store.syncState.get("calendar");
      expect(state.state).toBe("error");
      expect(state.lastError).toBe("Calendar ICS file exceeds maximum size");
    } finally {
      cleanup();
    }
  });

  it("strips control characters from ICS-derived strings", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "control-chars.ics");
    writeFileSync(
      path,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:ctrl-1@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T130000Z",
        "DTEND:20261020T140000Z",
        "SUMMARY:\u001b[31m\u0000Team Sync\u0000\u001b[0m",
        "STATUS:CONFIRMED",
        'ATTENDEE;CN="\u001b[31mSam Chen\u001b[0m":mailto:sam@example.com',
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      "utf8",
    );

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      await runCalendar(ctx, sqlite.store);

      const meeting = sqlite.store.meetings
        .listRange("2026-10-20T00:00:00.000Z", "2026-10-21T00:00:00.000Z")
        .find((m) => m.title.includes("Team Sync")) as Meeting;
      expect(meeting).toBeDefined();
      expect(meeting.title).toBe("[31mTeam Sync[0m");
      expect(/[\p{Cc}\p{Cf}]/u.test(meeting.title)).toBe(false);
      const sam = meeting.attendees.find((a) => a.email === "sam@example.com");
      expect(sam?.displayName).toBe("[31mSam Chen[0m");
      expect(/[\p{Cc}\p{Cf}]/u.test(sam?.displayName ?? "")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("drops a non-http URL value as null", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "bad-url.ics");
    writeFileSync(
      path,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:url-1@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T130000Z",
        "DTEND:20261020T140000Z",
        "SUMMARY:Meeting with bad URL",
        "URL:javascript:alert(1)",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      "utf8",
    );

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      await runCalendar(ctx, sqlite.store);

      const meeting = sqlite.store.meetings
        .listRange("2026-10-20T00:00:00.000Z", "2026-10-21T00:00:00.000Z")
        .find((m) => m.title === "Meeting with bad URL") as Meeting;
      expect(meeting.url).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("rejects an ICS event field that exceeds the maximum length", async () => {
    const { dir, cleanup } = tempDir();
    const path = join(dir, "long-title.ics");
    writeFileSync(
      path,
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:long-1@example.com",
        "DTSTAMP:20261020T120000Z",
        "DTSTART:20261020T130000Z",
        "DTEND:20261020T140000Z",
        `SUMMARY:${"x".repeat(2001)}`,
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      "utf8",
    );

    const ctx = makeContext({ transport: "ics", filePath: path }, fixtureInvoker({}), sqlite.store);

    try {
      const result = await runCalendar(ctx, sqlite.store);

      expect(result).toEqual({ pages: 0, items: 0 });
      const state = sqlite.store.syncState.get("calendar");
      expect(state.state).toBe("error");
      expect(state.lastError).toBe("Calendar ICS event field exceeds maximum length");

      const meetings = sqlite.store.meetings.listRange(
        "2026-10-20T00:00:00.000Z",
        "2026-10-21T00:00:00.000Z",
        { includeCancelled: true },
      );
      expect(meetings).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});
