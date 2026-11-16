import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUlidIdGen, fixedClock, type IdGen } from "@emos/core";
import { createStore, type Db, migrate, openDb } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { type ImportCtx, type ImportUnit, runUnits } from "./framework.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "emos-importer-test-"));
}

function makeStore(): { store: ReturnType<typeof createStore>; db: Db; cleanup: () => void } {
  const dir = tmpDir();
  const dbPath = join(dir, "emos.db");
  const db = openDb(dbPath);
  migrate(db);
  const store = createStore(db);
  return {
    store,
    db,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // ignore
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeCtx(ids: IdGen): ImportCtx {
  return {
    ids,
    clock: fixedClock("2026-10-20T16:00:00.000Z"),
    timeZone: "UTC",
    selfPersonId: "per_self",
    selfName: "Morgan",
    personByName: () => null,
    goalBySlug: () => null,
    unparseable: () => {},
  };
}

const T0 = "2026-10-20T16:00:00.000Z";

describe("runUnits", () => {
  const contexts: { cleanup: () => void }[] = [];
  afterEach(() => {
    for (const ctx of contexts.splice(0)) ctx.cleanup();
  });

  function freshStore() {
    const ctx = makeStore();
    contexts.push(ctx);
    return ctx;
  }

  it("is idempotent: second run creates 0 records", () => {
    const { store } = freshStore();
    const ids = createUlidIdGen(fixedClock(T0), randomBytes);
    const ctx = makeCtx(ids);

    const unit: ImportUnit = {
      key: "import:person:test",
      entity: "person",
      describe: "Test person",
      apply(s) {
        const person = s.people.create({
          displayName: "Test Person",
          relationship: "other",
          pronouns: null,
          aliases: [],
          role: null,
          timeZone: null,
          archived: false,
          oneOnOneCadenceDays: null,
          occurredAt: T0,
          retentionState: "active",
        });
        return { entityId: person.id, created: true };
      },
    };

    const first = runUnits(store, [unit], ctx, false);
    expect(first.created).toBe(1);
    expect(first.existing).toBe(0);

    const second = runUnits(store, [unit], ctx, false);
    expect(second.created).toBe(0);
    expect(second.existing).toBe(1);
  });

  it("dryRun leaves the DB unchanged", () => {
    const { store, db } = freshStore();
    const ids = createUlidIdGen(fixedClock(T0), randomBytes);
    const ctx = makeCtx(ids);

    const unit: ImportUnit = {
      key: "import:person:dry",
      entity: "person",
      describe: "Dry-run person",
      apply(s) {
        const person = s.people.create({
          displayName: "Dry Person",
          relationship: "other",
          pronouns: null,
          aliases: [],
          role: null,
          timeZone: null,
          archived: false,
          oneOnOneCadenceDays: null,
          occurredAt: T0,
          retentionState: "active",
        });
        return { entityId: person.id, created: true };
      },
    };

    const before = db.prepare("SELECT count(*) AS n FROM people").get<{ n: number }>()?.n ?? 0;
    const report = runUnits(store, [unit], ctx, true);
    const after = db.prepare("SELECT count(*) AS n FROM people").get<{ n: number }>()?.n ?? 0;

    expect(report.created).toBe(1);
    expect(after).toBe(before);
  });
});
