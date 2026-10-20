import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Db } from "./driver.js";
import { migrate, pendingMigrations } from "./migrate.js";
import { migrations } from "./migrations/index.js";
import { SQL } from "./migrations/sql.generated.js";
import { openDb } from "./open.js";
import { cleanup, DATED_COLS, DATED_VALS, T0, tmp, track } from "./test-helpers.js";

afterEach(cleanup);

const PHASE_1_TABLES = [
  "accomplishments",
  "audit_events",
  "commitment_sources",
  "commitments",
  "day_plans",
  "decisions",
  "documents",
  "goals",
  "identities",
  "import_keys",
  "layouts",
  "mcp_clients",
  "meeting_attendees",
  "meeting_notes",
  "meetings",
  "people",
  "person_notes",
  "record_sources",
  "risks",
  "schema_migrations",
  "settings",
  "source_items",
  "sync_state",
];

const DATED_TABLES = [
  "accomplishments",
  "commitments",
  "decisions",
  "documents",
  "goals",
  "identities",
  "meetings",
  "people",
  "person_notes",
  "risks",
  "source_items",
];

function tables(db: Db): string[] {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all<{ name: string }>()
    .map((r) => r.name);
}

function columns(db: Db, table: string): string[] {
  return db
    .prepare("SELECT name FROM pragma_table_xinfo(?) ORDER BY cid")
    .all<{ name: string }>(table)
    .map((r) => r.name);
}

const count = (db: Db, table: string) =>
  db.prepare(`SELECT count(*) AS n FROM ${table}`).get<{ n: number }>()?.n;

// --- tiny row builders (synthetic data only) -------------------------------------------------

function person(db: Db, id: string, relationship = "direct_report") {
  db.prepare(
    `INSERT INTO people (id, display_name, relationship, aliases, archived, ${DATED_COLS})
     VALUES (?, ?, ?, '[]', 0, ?, ?, ?, ?)`,
  ).run(id, `Person ${id}`, relationship, ...DATED_VALS);
}

function identity(db: Db, id: string, personId: string, source: string, handle: string) {
  db.prepare(
    `INSERT INTO identities (id, person_id, source, handle, confirmed, ${DATED_COLS})
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(id, personId, source, handle, ...DATED_VALS);
}

function sourceItem(db: Db, id: string, connectorId: string, externalId: string) {
  db.prepare(
    `INSERT INTO source_items (id, connector_id, external_id, kind, origin, text, content_hash,
       sensitivity, ${DATED_COLS})
     VALUES (?, ?, ?, 'message', 'connector', 'hello', 'h1', 'normal', ?, ?, ?, ?)`,
  ).run(id, connectorId, externalId, ...DATED_VALS);
}

function meeting(db: Db, id: string, connectorId: string, externalId: string) {
  db.prepare(
    `INSERT INTO meetings (id, connector_id, external_id, title, start_at, end_at, all_day, status,
       classification, classification_source, action_items, ${DATED_COLS})
     VALUES (?, ?, ?, 'Standup', ?, ?, 0, 'confirmed', 'standup', 'auto', '[]', ?, ?, ?, ?)`,
  ).run(id, connectorId, externalId, T0, "2026-10-20T16:15:00.000Z", ...DATED_VALS);
}

function commitment(db: Db, id: string, ownerId: string, extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    direction: "mine",
    status: "active",
    tags: "[]",
    created_by: "user",
    owner_id: ownerId,
    title: "Send feedback",
    notes: "",
    pinned: 0,
    occurred_at: T0,
    captured_at: T0,
    updated_at: T0,
    retention_state: "active",
    ...extra,
  };
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO commitments (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
  ).run(...Object.values(row));
}

function risk(db: Db, id: string) {
  db.prepare(
    `INSERT INTO risks (id, title, status, links, ${DATED_COLS})
     VALUES (?, 'Vendor slip', 'open', '[]', ?, ?, ?, ?)`,
  ).run(id, ...DATED_VALS);
}

// --- tests -----------------------------------------------------------------------------------

describe("migrate", () => {
  it("migrates idempotently", () => {
    const db = track(openDb(tmp()));
    expect(migrate(db).applied).toEqual([]);
  });

  it("applies every registered migration once on a fresh db, in order", () => {
    const file = tmp();
    const db = track(openDb(file, { migrations: [] }));
    expect(tables(db)).toEqual([]);
    expect(migrate(db).applied).toEqual(migrations.map((m) => m.name));
    expect(migrate(db).applied).toEqual([]);
    const rows = db
      .prepare("SELECT name, applied_at FROM schema_migrations ORDER BY rowid")
      .all<{ name: string; applied_at: string }>();
    expect(rows.map((r) => r.name)).toEqual(migrations.map((m) => m.name));
    for (const r of rows) expect(r.applied_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it("re-opening applies nothing", () => {
    const file = tmp();
    openDb(file).close();
    const db = track(openDb(file));
    expect(pendingMigrations(db, migrations)).toEqual([]);
  });

  it("runs each migration in its own transaction", () => {
    const db = track(openDb(tmp()));
    const ok = { name: "p9-01_ok", sql: "CREATE TABLE t_ok (id TEXT) STRICT;" };
    const bad = { name: "p9-02_bad", sql: "CREATE TABLE t_bad (id TEXT) STRICT; SELECT nope();" };
    expect(() => migrate(db, [...migrations, ok, bad])).toThrow();
    expect(tables(db)).toContain("t_ok");
    expect(tables(db)).not.toContain("t_bad");
    expect(pendingMigrations(db, [...migrations, ok, bad]).map((m) => m.name)).toEqual([
      "p9-02_bad",
    ]);
  });

  it("refuses a database that has migrations this build does not know (downgrade)", () => {
    const db = track(openDb(tmp()));
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
      "p9-99_from_the_future",
      T0,
    );
    expect(() => migrate(db)).toThrow(/p9-99_from_the_future/);
  });

  it("rejects a registry with duplicate names", () => {
    const db = track(openDb(tmp()));
    const m = { name: "p9-03_dup", sql: "SELECT 1;" };
    expect(() => migrate(db, [...migrations, m, m])).toThrow(/duplicate/i);
  });

  it("keeps foreign keys on after migrating, and rejects a migration that breaks them", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1");
    identity(db, "idn_1", "per_1", "chat", "@a");
    const breaks = { name: "p9-04_breaks_fk", sql: "DELETE FROM people;" };
    expect(() => migrate(db, [...migrations, breaks])).toThrow(/foreign key/i);
    expect(count(db, "people")).toBe(1);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });
});

describe("migration registry", () => {
  const dir = fileURLToPath(new URL("./migrations/", import.meta.url));

  it("registers every .sql file exactly once, in file order", () => {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, -4));
    expect([...migrations.map((m) => m.name)].sort()).toEqual([...files].sort());
  });

  it("sql.generated.ts is up to date with the .sql files (run `npm run gen:migrations -w @emos/store-sqlite`)", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
    expect(Object.keys(SQL).sort()).toEqual(files.map((f) => f.slice(0, -4)).sort());
    for (const f of files) {
      const src = readFileSync(`${dir}${f}`, "utf8").replaceAll("\r\n", "\n");
      expect(SQL[f.slice(0, -4) as keyof typeof SQL], f).toBe(src);
    }
  });

  it("registry SQL matches the .sql source byte for byte", () => {
    for (const m of migrations) {
      const src = readFileSync(new URL(`./migrations/${m.name}.sql`, import.meta.url), "utf8");
      expect(m.sql).toBe(src.replaceAll("\r\n", "\n"));
    }
  });
});

describe("schema 0001", () => {
  it("a fresh DB has every Phase 1 table", () => {
    const db = track(openDb(tmp()));
    expect(tables(db)).toEqual(PHASE_1_TABLES);
  });

  it("every dated table has the time/retention columns", () => {
    const db = track(openDb(tmp()));
    for (const t of DATED_TABLES) {
      expect(columns(db, t), t).toEqual(
        expect.arrayContaining(["occurred_at", "captured_at", "updated_at", "retention_state"]),
      );
    }
    const withOccurred = tables(db).filter((t) => columns(db, t).includes("occurred_at"));
    expect(withOccurred).toEqual(DATED_TABLES);
  });

  it("has occurred_at index on every dated table", () => {
    const db = track(openDb(tmp()));
    for (const t of DATED_TABLES) {
      const indexes = db.prepare("SELECT name FROM pragma_index_list(?)").all<{ name: string }>(t);
      const leading = indexes.map((i) =>
        db
          .prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
          .all<{ name: string }>(i.name)
          .map((c) => c.name),
      );
      expect(leading, t).toContainEqual(["occurred_at", "retention_state"]);
    }
  });

  it("uses the exact column lists for the fixed-shape tables", () => {
    const db = track(openDb(tmp()));
    expect(columns(db, "audit_events")).toEqual([
      "id",
      "entity",
      "entity_id",
      "action",
      "actor",
      "at",
      "note",
      "diff",
    ]);
    expect(columns(db, "settings")).toEqual(["key", "value"]);
    expect(columns(db, "layouts")).toEqual(["surface", "entries"]);
    expect(columns(db, "day_plans")).toEqual(["local_date", "commitment_ids", "created_at"]);
    expect(columns(db, "sync_state")).toEqual([
      "connector_id",
      "cursor",
      "state",
      "last_attempt_at",
      "last_success_at",
      "last_error",
      "item_count",
    ]);
    expect(columns(db, "mcp_clients")).toEqual([
      "id",
      "name",
      "token_hash",
      "allow_sensitive",
      "created_at",
      "revoked_at",
    ]);
    expect(columns(db, "import_keys")).toEqual(["key", "entity", "entity_id"]);
    expect(columns(db, "meeting_notes")).toEqual(["meeting_id", "source_item_id"]);
    expect(columns(db, "commitment_sources")).toEqual(["commitment_id", "source_item_id"]);
    expect(columns(db, "record_sources")).toEqual(["entity", "entity_id", "source_item_id"]);
  });

  it("mirrors the entity fields in snake_case", () => {
    const db = track(openDb(tmp()));
    const dated = ["occurred_at", "captured_at", "updated_at", "retention_state"];
    expect(columns(db, "people")).toEqual([
      "id",
      "display_name",
      "relationship",
      "pronouns",
      "aliases",
      "role",
      "time_zone",
      "archived",
      "one_on_one_cadence_days",
      ...dated,
    ]);
    expect(columns(db, "identities")).toEqual([
      "id",
      "person_id",
      "source",
      "handle",
      "confirmed",
      ...dated,
    ]);
    expect(columns(db, "person_notes")).toEqual([
      "id",
      "person_id",
      "text",
      "tags",
      "source_url",
      "sensitivity",
      "origin",
      "review_state",
      ...dated,
    ]);
    expect(columns(db, "goals")).toEqual([
      "id",
      "title",
      "slug",
      "subject_person_id",
      "horizon",
      "kind",
      "status",
      "target_date",
      "sensitivity",
      ...dated,
    ]);
    expect(columns(db, "commitments")).toEqual([
      "id",
      "direction",
      "status",
      "drop_reason",
      "urgency",
      "priority",
      "due",
      "due_date",
      "tags",
      "created_by",
      "owner_id",
      "counterpart_id",
      "goal_id",
      "meeting_id",
      "title",
      "notes",
      "pinned",
      "effort_minutes",
      "snoozed_until",
      "completed_at",
      "recurrence",
      "series_id",
      ...dated,
    ]);
    expect(columns(db, "meetings")).toEqual([
      "id",
      "connector_id",
      "external_id",
      "title",
      "start_at",
      "end_at",
      "all_day",
      "status",
      "self_response",
      "classification",
      "classification_source",
      "person_id",
      "action_items",
      "url",
      ...dated,
    ]);
    expect(columns(db, "meeting_attendees")).toEqual([
      "meeting_id",
      "position",
      "identity_id",
      "person_id",
      "display_name",
      "email",
    ]);
    expect(columns(db, "source_items")).toEqual([
      "id",
      "connector_id",
      "external_id",
      "kind",
      "origin",
      "url",
      "author_identity_id",
      "text",
      "content_hash",
      "sensitivity",
      "sections",
      ...dated,
    ]);
    expect(columns(db, "risks")).toEqual(["id", "title", "status", "owner_id", "links", ...dated]);
    expect(columns(db, "decisions")).toEqual([
      "id",
      "title",
      "status",
      "owner_id",
      "links",
      ...dated,
    ]);
    expect(columns(db, "documents")).toEqual([
      "id",
      "connector_id",
      "url",
      "title",
      "owner_person_id",
      "kind",
      "shared_with_me",
      "last_modified",
      ...dated,
    ]);
    expect(columns(db, "accomplishments")).toEqual([
      "id",
      "subject_person_id",
      "summary",
      "impact",
      "tags",
      "sensitivity",
      "status",
      ...dated,
    ]);
  });

  it("identity handles are unique case-insensitively", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1");
    identity(db, "idn_1", "per_1", "chat", "@Alex");
    expect(() => identity(db, "idn_2", "per_1", "chat", "@alex")).toThrow(/UNIQUE/);
    // Same handle on a different source is fine.
    identity(db, "idn_3", "per_1", "email", "@alex");
    // And lookups are case-insensitive too.
    expect(
      db.prepare("SELECT id FROM identities WHERE source = ? AND handle = ?").get("chat", "@ALEX"),
    ).toEqual({ id: "idn_1" });
  });

  it("enforces source item uniqueness", () => {
    const db = track(openDb(tmp()));
    sourceItem(db, "src_1", "chat", "m-1");
    expect(() => sourceItem(db, "src_2", "chat", "m-1")).toThrow(/UNIQUE/);
    sourceItem(db, "src_3", "email", "m-1");
  });

  it("enforces meeting uniqueness per (connector_id, external_id)", () => {
    const db = track(openDb(tmp()));
    meeting(db, "mtg_1", "cal", "ev-1");
    expect(() => meeting(db, "mtg_2", "cal", "ev-1")).toThrow(/UNIQUE/);
  });

  it("goal slugs are unique but optional", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1", "self");
    const goal = (id: string, slug: string | null) =>
      db
        .prepare(
          `INSERT INTO goals (id, title, slug, subject_person_id, horizon, kind, status, sensitivity,
             ${DATED_COLS}) VALUES (?, 'G', ?, 'per_1', 'quarter', 'team', 'active', 'normal', ?, ?, ?, ?)`,
        )
        .run(id, slug, ...DATED_VALS);
    goal("gol_1", "proj-x");
    expect(() => goal("gol_2", "proj-x")).toThrow(/UNIQUE/);
    goal("gol_3", null);
    goal("gol_4", null);
  });

  it("allows only one self person", () => {
    const db = track(openDb(tmp()));
    person(db, "per_me", "self");
    expect(() => person(db, "per_me2", "self")).toThrow(/UNIQUE/);
  });

  it("rejects values outside the contract enums", () => {
    const db = track(openDb(tmp()));
    expect(() => person(db, "per_1", "boss")).toThrow(/CHECK/);
    person(db, "per_1");
    expect(() => commitment(db, "cmt_1", "per_1", { status: "maybe" })).toThrow(/CHECK/);
    expect(() => commitment(db, "cmt_1", "per_1", { priority: 4 })).toThrow(/CHECK/);
    expect(() => commitment(db, "cmt_1", "per_1", { retention_state: "gone" })).toThrow(/CHECK/);
    expect(() => commitment(db, "cmt_1", "per_1", { pinned: 2 })).toThrow(/CHECK/);
  });

  it("drop_reason is only set on dropped commitments", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1");
    expect(() => commitment(db, "cmt_1", "per_1", { drop_reason: "user" })).toThrow(/CHECK/);
    commitment(db, "cmt_2", "per_1", { status: "dropped", drop_reason: "user" });
  });

  it("validates JSON columns and exposes due_date for range queries", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1");
    expect(() => commitment(db, "cmt_1", "per_1", { tags: "{}" })).toThrow(/CHECK/);
    expect(() => commitment(db, "cmt_1", "per_1", { tags: "not json" })).toThrow();
    commitment(db, "cmt_2", "per_1", {
      due: JSON.stringify({ date: "2026-10-23", time: null, timeZone: "America/Los_Angeles" }),
      tags: JSON.stringify(["hiring"]),
    });
    expect(db.prepare("SELECT due_date FROM commitments WHERE id = 'cmt_2'").get()).toEqual({
      due_date: "2026-10-23",
    });
  });

  it("join tables cascade when the owning record is deleted", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1");
    commitment(db, "cmt_1", "per_1");
    meeting(db, "mtg_1", "cal", "ev-1");
    sourceItem(db, "src_1", "chat", "m-1");
    db.prepare("INSERT INTO commitment_sources VALUES ('cmt_1', 'src_1')").run();
    db.prepare("INSERT INTO meeting_notes VALUES ('mtg_1', 'src_1')").run();
    db.prepare(
      "INSERT INTO meeting_attendees (meeting_id, position, display_name) VALUES ('mtg_1', 0, 'A')",
    ).run();
    db.prepare("DELETE FROM commitments WHERE id = 'cmt_1'").run();
    db.prepare("DELETE FROM meetings WHERE id = 'mtg_1'").run();
    expect(count(db, "commitment_sources")).toBe(0);
    expect(count(db, "meeting_notes")).toBe(0);
    expect(count(db, "meeting_attendees")).toBe(0);
  });

  it("people cannot be deleted while records reference them", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1");
    person(db, "per_2");
    commitment(db, "cmt_1", "per_1", { counterpart_id: "per_2" });
    expect(() => db.prepare("DELETE FROM people WHERE id = 'per_2'").run()).toThrow(/FOREIGN KEY/);
  });

  it("optional links to meetings and goals are cleared when those are deleted", () => {
    const db = track(openDb(tmp()));
    person(db, "per_1");
    meeting(db, "mtg_1", "cal", "ev-1");
    commitment(db, "cmt_1", "per_1", { meeting_id: "mtg_1" });
    db.prepare("DELETE FROM meetings WHERE id = 'mtg_1'").run();
    expect(db.prepare("SELECT meeting_id FROM commitments").get()).toEqual({ meeting_id: null });
  });

  it("record_sources only links existing risks, decisions, documents and accomplishments", () => {
    const db = track(openDb(tmp()));
    sourceItem(db, "src_1", "chat", "m-1");
    risk(db, "rsk_1");
    db.prepare("INSERT INTO record_sources VALUES ('risk', 'rsk_1', 'src_1')").run();
    expect(() =>
      db.prepare("INSERT INTO record_sources VALUES ('risk', 'rsk_missing', 'src_1')").run(),
    ).toThrow(/record_sources/);
    expect(() =>
      db.prepare("INSERT INTO record_sources VALUES ('commitment', 'rsk_1', 'src_1')").run(),
    ).toThrow(/CHECK/);
    db.prepare("DELETE FROM risks WHERE id = 'rsk_1'").run();
    expect(count(db, "record_sources")).toBe(0);
  });

  it("keeps sync cursors, day plans, settings and layouts as JSON/text rows", () => {
    const db = track(openDb(tmp()));
    db.prepare("INSERT INTO sync_state (connector_id) VALUES ('cal')").run();
    expect(db.prepare("SELECT state, item_count, cursor FROM sync_state").get()).toEqual({
      state: "never",
      item_count: 0,
      cursor: null,
    });
    expect(() =>
      db.prepare("INSERT INTO sync_state (connector_id, state) VALUES ('x', 'weird')").run(),
    ).toThrow(/CHECK/);
    db.prepare("INSERT INTO day_plans VALUES ('2026-10-20', '[\"cmt_1\"]', ?)").run(T0);
    expect(() => db.prepare("INSERT INTO day_plans VALUES ('20 Oct', '[]', ?)").run(T0)).toThrow(
      /CHECK/,
    );
    db.prepare("INSERT INTO settings VALUES ('profile', '{\"onboarded\":false}')").run();
    expect(() => db.prepare("INSERT INTO settings VALUES ('bad', '{')").run()).toThrow(/CHECK/);
    db.prepare("INSERT INTO layouts VALUES ('dashboard', '[]')").run();
  });

  it("mcp client names are unique among live clients; token hashes are always unique", () => {
    const db = track(openDb(tmp()));
    const add = (id: string, name: string, hash: string) =>
      db
        .prepare(
          "INSERT INTO mcp_clients (id, name, token_hash, allow_sensitive, created_at) VALUES (?, ?, ?, 0, ?)",
        )
        .run(id, name, hash, T0);
    const revoke = (id: string) =>
      db.prepare("UPDATE mcp_clients SET revoked_at = ? WHERE id = ?").run(T0, id);
    add("mcl_1", "claude", "h1");
    expect(() => add("mcl_2", "claude", "h2")).toThrow(/UNIQUE/);
    expect(() => add("mcl_3", "other", "h1")).toThrow(/UNIQUE/);

    // Revoking frees the name for a new client; the revoked row is kept for the audit trail.
    revoke("mcl_1");
    add("mcl_4", "claude", "h4");
    revoke("mcl_4");
    add("mcl_5", "claude", "h5");
    expect(() => add("mcl_6", "claude", "h6")).toThrow(/UNIQUE/);
    // A revoked client's token hash still can't be reused.
    expect(() => add("mcl_7", "fresh", "h1")).toThrow(/UNIQUE/);
    // Un-revoking a client whose name is taken by a live one is refused.
    expect(() =>
      db.prepare("UPDATE mcp_clients SET revoked_at = NULL WHERE id = 'mcl_1'").run(),
    ).toThrow(/UNIQUE/);
  });
});

describe("migrate safety", () => {
  it("refuses to run inside an open transaction (foreign_keys cannot be switched off there)", () => {
    const db = track(openDb(tmp()));
    const m = { name: "p9-05_in_tx", sql: "CREATE TABLE t_in_tx (id TEXT) STRICT;" };
    expect(() => db.transaction(() => migrate(db, [...migrations, m]))).toThrow(/transaction/);
    expect(tables(db)).not.toContain("t_in_tx");
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("skips a migration another connection applied after the pending list was read", () => {
    const file = tmp();
    const a = track(openDb(file));
    const b = track(openDb(file));
    const m = { name: "p9-06_race", sql: "CREATE TABLE t_race (id TEXT) STRICT;" };
    const list = [...migrations, m];
    let raced = false;
    // Wrap A so that B applies `m` just before A opens its first migration transaction.
    const racing: Db = {
      ...a,
      transaction<T>(fn: () => T): T {
        if (!raced) {
          raced = true;
          expect(migrate(b, list).applied).toEqual(["p9-06_race"]);
        }
        return a.transaction(fn);
      },
    };
    expect(migrate(racing, list).applied).toEqual([]);
    expect(count(a, "schema_migrations")).toBe(list.length);
  });
});

// The documented rebuild recipe (0001 header, migrations/index.ts header), exercised on
// `documents`, whose name is referenced by the record_sources triggers. Widens `kind`.
const RECORD_SOURCES_TRIGGERS = `
CREATE TRIGGER record_sources_entity_insert BEFORE INSERT ON record_sources
WHEN CASE NEW.entity
  WHEN 'risk' THEN NOT EXISTS (SELECT 1 FROM risks WHERE id = NEW.entity_id)
  WHEN 'decision' THEN NOT EXISTS (SELECT 1 FROM decisions WHERE id = NEW.entity_id)
  WHEN 'document' THEN NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.entity_id)
  WHEN 'accomplishment' THEN NOT EXISTS (SELECT 1 FROM accomplishments WHERE id = NEW.entity_id)
  ELSE 0
END
BEGIN
  SELECT RAISE(ABORT, 'record_sources: entity_id does not exist');
END;
CREATE TRIGGER record_sources_entity_update BEFORE UPDATE OF entity, entity_id ON record_sources
WHEN CASE NEW.entity
  WHEN 'risk' THEN NOT EXISTS (SELECT 1 FROM risks WHERE id = NEW.entity_id)
  WHEN 'decision' THEN NOT EXISTS (SELECT 1 FROM decisions WHERE id = NEW.entity_id)
  WHEN 'document' THEN NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.entity_id)
  WHEN 'accomplishment' THEN NOT EXISTS (SELECT 1 FROM accomplishments WHERE id = NEW.entity_id)
  ELSE 0
END
BEGIN
  SELECT RAISE(ABORT, 'record_sources: entity_id does not exist');
END;
`;

const REBUILD_DOCUMENTS = `
DROP TRIGGER record_sources_entity_insert;
DROP TRIGGER record_sources_entity_update;
CREATE TABLE documents_new (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_person_id TEXT REFERENCES people (id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('brag_doc', 'design_doc', 'rubric', 'runbook', 'other')),
  shared_with_me INTEGER NOT NULL DEFAULT 0 CHECK (shared_with_me IN (0, 1)),
  last_modified TEXT CHECK (last_modified GLOB '????-??-??T??:??:??.???Z'),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
INSERT INTO documents_new SELECT * FROM documents;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
CREATE INDEX documents_occurred_idx ON documents (occurred_at, retention_state);
CREATE INDEX documents_owner_idx ON documents (owner_person_id);
CREATE TRIGGER documents_delete_sources AFTER DELETE ON documents BEGIN
  DELETE FROM record_sources WHERE entity = 'document' AND entity_id = OLD.id;
END;
${RECORD_SOURCES_TRIGGERS}`;

describe("table rebuild recipe", () => {
  const schemaObjects = (db: Db, type: string) =>
    db
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = ? ORDER BY name")
      .all<{ name: string; tbl_name: string }>(type);

  function doc(db: Db, id: string, kind: string) {
    db.prepare(
      `INSERT INTO documents (id, connector_id, url, title, kind, shared_with_me, ${DATED_COLS})
       VALUES (?, 'docs', ?, 'Doc', ?, 0, ?, ?, ?, ?)`,
    ).run(id, `https://docs.example.com/${id}`, kind, ...DATED_VALS);
  }

  it("rebuilds documents through migrate() keeping triggers, indexes and record_sources integrity", () => {
    const db = track(openDb(tmp()));
    sourceItem(db, "src_1", "chat", "m-1");
    doc(db, "doc_1", "brag_doc");
    db.prepare("INSERT INTO record_sources VALUES ('document', 'doc_1', 'src_1')").run();
    const triggersBefore = schemaObjects(db, "trigger");
    const indexesBefore = schemaObjects(db, "index");

    const rebuild = { name: "p9-07_documents_runbook", sql: REBUILD_DOCUMENTS };
    expect(migrate(db, [...migrations, rebuild]).applied).toEqual([rebuild.name]);

    expect(schemaObjects(db, "trigger")).toEqual(triggersBefore);
    expect(schemaObjects(db, "index")).toEqual(indexesBefore);
    // Data survived and the widened enum is accepted.
    expect(count(db, "documents")).toBe(1);
    expect(count(db, "record_sources")).toBe(1);
    doc(db, "doc_2", "runbook");
    // record_sources integrity is still enforced in both directions.
    expect(() =>
      db.prepare("INSERT INTO record_sources VALUES ('document', 'doc_missing', 'src_1')").run(),
    ).toThrow(/record_sources/);
    db.prepare("DELETE FROM documents WHERE id = 'doc_1'").run();
    expect(count(db, "record_sources")).toBe(0);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("the recipe's trigger text matches 0001 (keep the documented recipe honest)", () => {
    const db = track(openDb(tmp()));
    const sqlOf = (name: string) =>
      db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get<{ sql: string }>(name)?.sql;
    for (const name of ["record_sources_entity_insert", "record_sources_entity_update"]) {
      const fromRecipe = RECORD_SOURCES_TRIGGERS.slice(
        RECORD_SOURCES_TRIGGERS.indexOf(`CREATE TRIGGER ${name}`),
      );
      const stored = sqlOf(name)?.replace(/\s*--[^\n]*/g, "");
      expect(stored, name).toBeDefined();
      expect(fromRecipe.startsWith(stored ?? "")).toBe(true);
    }
  });
});
