import type { NewCommitment } from "@emos/api-contract";
import { fixedClock } from "@emos/core";
import { createCommitmentsRepo, openDb } from "@emos/store-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServiceContext } from "../context.js";
import {
  commitmentsComplete,
  commitmentsGet,
  commitmentsReopen,
  commitmentsSnooze,
} from "./commitments.js";

const now = "2026-10-24T12:00:00.000Z";
let db: ReturnType<typeof openDb>;
let sequence = 0;
let ctx: ServiceContext;

function person(id: string): void {
  db.prepare(`INSERT INTO people
    (id, display_name, relationship, aliases, archived, occurred_at, captured_at, updated_at, retention_state)
    VALUES (?, ?, 'other', '[]', 0, ?, ?, ?, 'active')`).run(id, id, now, now, now);
}

function input(over: Partial<NewCommitment> = {}): NewCommitment {
  return {
    direction: "mine",
    status: "active",
    dropReason: null,
    urgency: null,
    priority: null,
    due: null,
    tags: [],
    createdBy: "user",
    ownerId: "per_owner",
    counterpartId: null,
    goalId: null,
    meetingId: null,
    title: "Synthetic commitment",
    notes: "",
    pinned: false,
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    ...over,
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  sequence = 0;
  person("per_owner");
  const commitments = createCommitmentsRepo(db, {
    now: () => new Date(now),
    id: (prefix) => `${prefix}_${++sequence}`,
  });
  ctx = {
    db,
    store: { transaction: <T>(fn: () => T): T => db.transaction(fn), commitments },
    clock: fixedClock(now),
    ids: { next: (prefix: string) => `${prefix}_${++sequence}` },
    events: { publish: () => undefined, subscribe: () => () => undefined },
  } as unknown as ServiceContext;
});
afterEach(() => db.close());

const repo = () => ctx.store.commitments;

describe("commitment handlers", () => {
  it("snooze stores snoozedUntil", () => {
    const c = repo().create(input());
    const result = commitmentsSnooze(ctx, { id: c.id, until: "2026-10-26T09:00:00.000Z" });
    expect(result).toMatchObject({ status: "snoozed", snoozedUntil: "2026-10-26T09:00:00.000Z" });
  });

  it("reopen by a system actor conflicts", () => {
    const c = repo().create(input({ status: "done", completedAt: now }));
    expect(() => commitmentsReopen(ctx, { id: c.id }, "system")).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("completing a weekly item creates one active next occurrence in the same series", () => {
    const c = repo().create(
      input({
        due: { date: "2026-10-23", time: null, timeZone: "UTC" },
        recurrence: { freq: "weekly", interval: 1, byWeekday: [5], byMonthDay: null },
        seriesId: "series_weekly",
      }),
    );
    commitmentsComplete(ctx, { id: c.id });
    const series = repo()
      .list({})
      .filter((item) => item.seriesId === "series_weekly");
    expect(series).toHaveLength(2);
    expect(series.find((item) => item.id !== c.id)).toMatchObject({
      status: "active",
      seriesId: "series_weekly",
      due: { date: "2026-10-30" },
    });
  });

  it("get returns linked sources and audit", async () => {
    db.prepare(`INSERT INTO source_items
      (id, connector_id, external_id, kind, origin, text, content_hash, sensitivity,
       occurred_at, captured_at, updated_at, retention_state)
      VALUES ('src_1', 'fixture', 'item-1', 'note', 'manual', 'Synthetic note', 'hash', 'normal', ?, ?, ?, 'active')`).run(
      now,
      now,
      now,
    );
    const c = repo().create(input(), ["src_1"]);
    commitmentsSnooze(ctx, { id: c.id, until: "2026-10-26T09:00:00.000Z" });
    const result = await commitmentsGet(ctx, { id: c.id });
    expect(result.sources.map((source) => source.id)).toEqual(["src_1"]);
    expect(result.audit.map((event) => event.action)).toEqual(["snooze"]);
  });
});
