import type { ServerEvent } from "@emos/api-contract";
import { fixedClock } from "@emos/core";
import { createCommitmentsRepo, openDb } from "@emos/store-sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { ServiceContext } from "../context.js";
import { commitmentsQuickCapture } from "./quick-capture.js";

const db = openDb(":memory:");
afterEach(() => db.exec("DELETE FROM audit_events; DELETE FROM commitments"));
afterAll(() => db.close());

describe("quick capture persistence validation", () => {
  it("rejects a malformed commitment before persistence, audit, or publication", () => {
    const published: ServerEvent[] = [];
    const commitments = createCommitmentsRepo(db, {
      now: () => new Date("2026-10-25T12:00:00.000Z"),
      id: () => "com_unexpected",
    });
    const ctx = {
      db,
      clock: fixedClock("2026-10-25T12:00:00.000Z"),
      store: {
        transaction: <T>(fn: () => T): T => db.transaction(fn),
        commitments,
        settings: {
          getProfile: () => ({
            // Deliberately emulate malformed stored profile data reaching the handler.
            selfPersonId: 42,
            displayTimeZone: "UTC",
          }),
        },
      },
      events: {
        publish: (event: ServerEvent) => published.push(event),
        subscribe: () => () => undefined,
      },
    } as unknown as ServiceContext;

    expect(() => commitmentsQuickCapture(ctx, { text: "Send update" })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(commitments.list({})).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) count FROM audit_events").get()).toEqual({ count: 0 });
    expect(published).toEqual([]);
  });
});
