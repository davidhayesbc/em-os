import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { constants, DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { wrapDatabase } from "./driver.js";
import { migrations } from "./migrations/index.js";
import { openDb } from "./open.js";
import { createStore } from "./store.js";
import { cleanup, DATED_COLS, DATED_VALS, T0, tmp, track } from "./test-helpers.js";

afterEach(cleanup);

function addPerson(db: ReturnType<typeof openDb>, id = "per_1") {
  db.prepare(
    `INSERT INTO people (id, display_name, relationship, aliases, archived, ${DATED_COLS})
     VALUES (?, ?, 'direct_report', '[]', 0, ?, ?, ?, ?)`,
  ).run(id, "Zoë Quinn", ...DATED_VALS);
}

describe("openDb", () => {
  it("creates the parent directory and the database file", () => {
    const file = tmp();
    track(openDb(file));
    expect(existsSync(file)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("creates the parent directory with mode 0o700", () => {
    const file = tmp();
    track(openDb(file));
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
  });

  it("enables WAL, foreign keys and a 5 s busy timeout", () => {
    const db = track(openDb(tmp()));
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  });

  it("enforces foreign keys", () => {
    const db = track(openDb(tmp()));
    expect(() =>
      db
        .prepare(
          `INSERT INTO identities (id, person_id, source, handle, confirmed, ${DATED_COLS})
           VALUES ('idn_1', 'per_missing', 'chat', '@alex', 0, ?, ?, ?, ?)`,
        )
        .run(...DATED_VALS),
    ).toThrow(/FOREIGN KEY/);
  });

  it("works with a path containing spaces and Unicode", () => {
    const file = join(dirname(tmp()), "sub dir ü", "emos.db");
    const db = track(openDb(file));
    addPerson(db);
    expect(db.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 1 });
  });

  it("backs up before applying a pending migration to an existing db", () => {
    const file = tmp();
    const first = openDb(file);
    addPerson(first);
    first.close();

    const extra = {
      name: "p9-99_test",
      sql: "CREATE TABLE test_extra (id TEXT PRIMARY KEY) STRICT;",
    };
    const db = track(openDb(file, { migrations: [...migrations, extra] }));
    const backup = join(dirname(dirname(file)), "backups", "pre-p9-99_test.db");
    expect(existsSync(backup)).toBe(true);
    expect(db.prepare("SELECT name FROM schema_migrations WHERE name = ?").get(extra.name)).toEqual(
      { name: extra.name },
    );

    // The backup is the pre-migration state: it has the data but not the new table.
    const copy = track(
      openDb(backup, { migrations: [...migrations], backupsDir: dirname(backup) }),
    );
    expect(copy.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 1 });
    expect(
      copy.prepare("SELECT name FROM sqlite_master WHERE name = 'test_extra'").get(),
    ).toBeUndefined();
  });

  it("a stale pre-<name>.db from an earlier attempt is replaced with the current state", () => {
    const file = tmp();
    const first = openDb(file);
    addPerson(first, "per_1");
    first.close();

    const backupsDir = join(dirname(file), "bk");
    mkdirSync(backupsDir, { recursive: true });
    const backup = join(backupsDir, "pre-p9-97_test.db");
    writeFileSync(backup, "stale bytes from a failed attempt long ago");

    // Data written since that attempt must be in the new snapshot.
    const second = openDb(file);
    addPerson(second, "per_2");
    second.close();

    const extra = { name: "p9-97_test", sql: "CREATE TABLE test_extra3 (id TEXT) STRICT;" };
    track(openDb(file, { backupsDir, migrations: [...migrations, extra] }));

    const copy = track(openDb(backup, { migrations: [...migrations], backupsDir }));
    expect(copy.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 2 });
    // Written via a temp file + rename: nothing else is left in the backups dir.
    expect(readdirSync(backupsDir).filter((f) => !f.startsWith("pre-p9-97_test.db"))).toEqual([]);
  });

  it("does not back up a brand-new database", () => {
    const file = tmp();
    track(openDb(file));
    expect(existsSync(join(dirname(dirname(file)), "backups"))).toBe(false);
  });

  it("does not back up when nothing is pending", () => {
    const file = tmp();
    openDb(file).close();
    track(openDb(file));
    expect(existsSync(join(dirname(dirname(file)), "backups"))).toBe(false);
  });

  it("honours an explicit backupsDir", () => {
    const file = tmp();
    openDb(file).close();
    const backupsDir = join(dirname(file), "elsewhere");
    const extra = { name: "p9-98_test", sql: "CREATE TABLE test_extra2 (id TEXT) STRICT;" };
    track(openDb(file, { backupsDir, migrations: [...migrations, extra] }));
    expect(existsSync(join(backupsDir, "pre-p9-98_test.db"))).toBe(true);
  });

  it("closes the handle and rethrows when a migration fails", () => {
    const file = tmp();
    const bad = { name: "p9-97_bad", sql: "CREATE TABLE people (id TEXT);" };
    expect(() => openDb(file, { migrations: [...migrations, bad] })).toThrow(/already exists/);
    // The failed migration rolled back; the good ones stayed applied.
    const db = track(openDb(file));
    const names = db.prepare("SELECT name FROM schema_migrations").all<{ name: string }>();
    expect(names.map((r) => r.name)).toEqual(migrations.map((m) => m.name));
  });
});

describe("Db adapter", () => {
  it("run returns the change count as a number", () => {
    const db = track(openDb(tmp()));
    addPerson(db, "per_1");
    addPerson(db, "per_2");
    const r = db.prepare("UPDATE people SET archived = 1").run();
    expect(r).toEqual({ changes: 2 });
    expect(typeof r.changes).toBe("number");
  });

  it("get returns undefined for no row; all returns []", () => {
    const db = track(openDb(tmp()));
    expect(db.prepare("SELECT * FROM people WHERE id = ?").get("nope")).toBeUndefined();
    expect(db.prepare("SELECT * FROM people").all()).toEqual([]);
  });

  it("binds booleans as 0/1", () => {
    const db = track(openDb(tmp()));
    addPerson(db);
    db.prepare("UPDATE people SET archived = ? WHERE id = ?").run(true, "per_1");
    expect(db.prepare("SELECT archived FROM people").get()).toEqual({ archived: 1 });
  });

  it("transaction commits on success and returns the result", () => {
    const db = track(openDb(tmp()));
    const out = db.transaction(() => {
      addPerson(db);
      return 42;
    });
    expect(out).toBe(42);
    expect(db.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 1 });
  });

  it("transaction rolls back and rethrows on error", () => {
    const db = track(openDb(tmp()));
    const boom = new Error("boom");
    expect(() =>
      db.transaction(() => {
        addPerson(db);
        throw boom;
      }),
    ).toThrow(boom);
    expect(db.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 0 });
  });

  it("nested transactions use savepoints: an inner failure rolls back only the inner work", () => {
    const db = track(openDb(tmp()));
    db.transaction(() => {
      addPerson(db, "per_outer");
      expect(() =>
        db.transaction(() => {
          addPerson(db, "per_inner");
          throw new Error("inner");
        }),
      ).toThrow("inner");
      db.transaction(() => addPerson(db, "per_inner_ok"));
    });
    const ids = db.prepare("SELECT id FROM people ORDER BY id").all<{ id: string }>();
    expect(ids.map((r) => r.id)).toEqual(["per_inner_ok", "per_outer"]);
  });

  it("an outer failure rolls back committed inner savepoints too", () => {
    const db = track(openDb(tmp()));
    expect(() =>
      db.transaction(() => {
        db.transaction(() => addPerson(db, "per_inner"));
        throw new Error("outer");
      }),
    ).toThrow("outer");
    expect(db.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 0 });
  });

  it("rejects an async transaction body and rolls it back", () => {
    const db = track(openDb(tmp()));
    expect(() =>
      db.transaction(() => {
        addPerson(db);
        return Promise.resolve(1);
      }),
    ).toThrow(/synchronous/);
    expect(db.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 0 });
  });

  it("backup produces a readable copy", async () => {
    const file = tmp();
    const db = track(openDb(file));
    addPerson(db, "per_1");
    addPerson(db, "per_2");
    const copyPath = join(dirname(file), "..", "exports", "copy.db");
    await db.backup(copyPath);
    const copy = track(openDb(copyPath));
    expect(copy.prepare("SELECT count(*) AS n FROM people").get()).toEqual({ n: 2 });
    expect(copy.prepare("SELECT count(*) AS n FROM schema_migrations").get()).toEqual({
      n: migrations.length,
    });
  });
});

describe("createStore", () => {
  it("implements the core Store port by delegating transaction to the Db", () => {
    const db = track(openDb(tmp()));
    const store = createStore(db);
    expect(() =>
      store.transaction(() => {
        addPerson(db);
        throw new Error("x");
      }),
    ).toThrow("x");
    expect(store.transaction(() => db.prepare("SELECT count(*) AS n FROM people").get())).toEqual({
      n: 0,
    });
  });

  it("stores timestamps in canonical UTC form only", () => {
    const db = track(openDb(tmp()));
    expect(() =>
      db
        .prepare(
          `INSERT INTO people (id, display_name, relationship, aliases, archived, ${DATED_COLS})
           VALUES ('per_x', 'X', 'other', '[]', 0, ?, ?, ?, 'active')`,
        )
        .run("2026-10-20T09:00:00-07:00", T0, T0),
    ).toThrow(/CHECK/);
  });
});

describe("Db adapter rollback failures", () => {
  it("a failing ROLLBACK never masks the original error", () => {
    const raw = new DatabaseSync(":memory:");
    let denyRollback = false;
    raw.setAuthorizer((action, arg1) =>
      denyRollback && action === constants.SQLITE_TRANSACTION && arg1 === "ROLLBACK"
        ? constants.SQLITE_DENY
        : constants.SQLITE_OK,
    );
    const db = track(wrapDatabase(raw));
    const original = new Error("original failure");
    expect(() =>
      db.transaction(() => {
        denyRollback = true;
        throw original;
      }),
    ).toThrow(original);
  });
});
