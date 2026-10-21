# ADR 0002: Local SQLite store

- **Status:** Accepted; driver chosen by Phase 0 spike (result recorded below: `node:sqlite`)
- **Date:** 2026-10-19
- **Spec:** §§6, 7.1, 10

## Context

The store is single-user and local. It needs relational integrity, migrations, full-text search, vectors at modest scale (tens of thousands of chunks), date-indexed queries, and transactional sync cursors. Only the service process opens it (ADR 0001), on macOS arm64 and Windows x64.

## Decision

- **Location and lifetime:**
  - one SQLite database per profile, in the OS per-user app-data directory (`~/Library/Application Support/EM OS/` on macOS, `%LOCALAPPDATA%\EM OS\` on Windows);
  - the service refuses to start if the directory is inside a git working tree.
- **Settings:**
  - WAL mode;
  - foreign keys on;
  - versioned forward-only migrations, with a migration test per version.
- **Indexing:**
  - every table carrying `occurred_at` has an index on `(occurred_at, retention_state)` (ADR 0004);
  - FTS5 tables are rebuildable projections;
  - vectors are L2-normalised Float32 `BLOB`s in `chunk` (ADR 0003).
- **Writes:**
  - sync cursors advance in the same transaction as the items they cover;
  - all access goes through the `Store` port with parameterised queries.
- **Backup:** `emos backup` takes a consistent online snapshot to a user-chosen path.

**Phase 0 spike, driver.** The candidates are:

- `node:sqlite`;
- `better-sqlite3`;
- a WASM build.

Run them on the runtime chosen in ADR 0001 and pick the simplest one that passes:

- FTS5 available;
- works on both OSes in that runtime;
- no network fetch at user install;
- acceptable batch write throughput;
- an online backup API.

Record the result here.

## Alternatives considered

- **Postgres + pgvector:** rejected. It means another service to run, which is overkill for one user.
- **Markdown/files as the database:** rejected. Structure ends up living in prose and regexes, which is the problem this product exists to fix.
- **A separate vector database:** rejected for now. It's a second store to keep consistent, and brute force is fast enough at this scale.

## Consequences

The data is one file that's easy to back up. The schema is a contract for connectors and importers, so migrations need tests. Because only the service opens the store, the native-ABI risk is confined to one runtime.

## Spike result (2026-10-19)

**Decision:**

- **`SQLITE_DRIVER`: `node:sqlite`.** It is built into the bundled Node 24 LTS runtime chosen in ADR 0001, so it adds no dependency and no native addon.
- Its stability is "release candidate" (1.2) since Node 24.15.0. It needs no flag and printed no `ExperimentalWarning` in our tests.
- Use `backup(db, path)` for `emos backup`. `VACUUM INTO` is a fallback.

**Method:** a throwaway script, run with each driver under each runtime on macOS arm64. Each run:

- creates a file DB with `PRAGMA journal_mode = WAL` and foreign keys on;
- runs `CREATE VIRTUAL TABLE t USING fts5(x)`;
- inserts 10,000 rows in one transaction, timed, then checks a `MATCH` query;
- inserts 10,000 rows into a plain table in one transaction, timed;
- takes an online backup to a second file and reopens it to count rows;
- runs `VACUUM INTO`.

Timings are medians of five runs, in milliseconds (FTS5 / plain). The runtimes are:

- Node 26.4.0 (system Node, used as the reference only);
- bundled Node 24.22.0;
- VS Code 1.142.0 Electron 43.7.7 as Node 24.21.0, run through the main `Code` binary and through `Code Helper (Plugin)`.

| Driver | FTS5 | WAL | Online backup API | Node 26.4 | Bundled Node 24.22 | Electron, `Code` | Electron, Plugin helper | Install |
|---|---|---|---|---|---|---|---|---|
| `node:sqlite` (SQLite 3.53.x) | yes | yes | yes, `backup()` (backup has 10,000 rows) | 12.9 / 3.7 | 11.9 / 3.6 | 12.0 / 3.6 | 12.6 / 4.0 | built in |
| `better-sqlite3` 13.0.3 | yes | yes | yes, `db.backup()` | 13.6 / 5.2 | 12.5 / 4.7 | **fails to load** (macOS library validation) | 11.8 / 4.7 | N-API prebuilds in the package, including win32-x64; no install script; about 2 MB per platform |
| `node-sqlite3-wasm` 0.8.60 | yes | **no** (`journal_mode` stays `delete`) | **no** (only `VACUUM INTO`) | 39.9 / 17.0 | 40.1 / 17.1 (1 run) | 42.1 / 15.9 | 41.5 / 16.0 | pure WASM, 1.3 MB |
| `sql.js` 1.15.0 | **no** ("no such module: fts5") | n/a (in-memory) | **no** (`export()` of the whole DB) | — / 11.5 (1 run) | — / 11.4 (1 run) | — / 10.2 (1 run) | not run | pure WASM |

**Why `node:sqlite`:**

- Both `node:sqlite` and `better-sqlite3` pass every hard criterion, at the same throughput (about 12 ms for 10k FTS5 rows).
- `node:sqlite` is simpler: no dependency, nothing to package per platform, and it can't hit a native-ABI or code-signing failure.
- `better-sqlite3` stays the fallback if `node:sqlite` turns out to lack something. Under `bundled-node` it would load fine.
- The WASM builds fail the WAL and online-backup criteria (`node-sqlite3-wasm`) or the FTS5 criterion (`sql.js`).

**Dev and CI use Node 24 too.** `.nvmrc` is `24`, `engines.node` is `>=24`, `@types/node` is `^24`, and CI uses `node-version: 24`. That way `node:sqlite` behaves the same in tests as in production: no flag and no `ExperimentalWarning`.

**Verified `node:sqlite` API surface (for P0-10).** A probe script checked these on bundled Node 24.22.0. Node 26.4.0 and Electron's Node 24.21.0 gave the same results for the transaction, backup, BigInt and import rows below.

- **Synchronous API.**
  - Module exports: `DatabaseSync`, `StatementSync`, `Session`, `backup`, `constants`.
  - `DatabaseSync` methods include `exec`, `prepare`, `close`, `open`, `function`, `aggregate`, `serialize`, `deserialize`, `createSession`, `applyChangeset`, `setAuthorizer`, `enableLoadExtension` and `loadExtension`.
  - `StatementSync` methods: `run`, `get`, `all`, `iterate`, `columns`, `setReadBigInts`, `setReturnArrays`, `setAllowBareNamedParameters`, `setAllowUnknownNamedParameters`.
  - `run()` returns `{ changes, lastInsertRowid }`.
- **No `.transaction()` helper.**
  - `db.transaction` is `undefined`. The `Store` adapter must issue `BEGIN` / `COMMIT` / `ROLLBACK` itself, using `SAVEPOINT` / `RELEASE` / `ROLLBACK TO` for nesting. `ROLLBACK TO` inside an outer `BEGIN` was verified.
  - `db.isTransaction` reports whether a transaction is open.
- **Integers.**
  - By default, `INTEGER` columns are read as JS `number`.
  - Reading a value above `Number.MAX_SAFE_INTEGER` throws `ERR_OUT_OF_RANGE`. It does not silently lose precision.
  - `stmt.setReadBigInts(true)`, or `new DatabaseSync(path, { readBigInts: true })`, returns `bigint` for every integer.
  - Writing a `bigint` parameter works.
- **Backup.**
  - `backup(sourceDb, destPath)` is a function exported by the `node:sqlite` module, not a `DatabaseSync` method (`db.backup` is `undefined`).
  - It returns a `Promise` that resolves to the number of pages copied.
- **Import requires the `node:` prefix.** `require('sqlite')` throws `MODULE_NOT_FOUND`. Import from `"node:sqlite"`.
- **Tooling resolution.**
  - A one-off test under the repo's Vitest 5.0.4 imported `{ backup, DatabaseSync }` from `"node:sqlite"`, created an FTS5 table and ran a `MATCH` query. It passed on Node 24.22.0 and on Node 26.4.0.
  - esbuild 0.28 with `--platform=node` left `node:sqlite` external, with the prefix intact.
  - The probe was deleted afterwards. P0-10 should still keep its own store tests as the lasting guard.

**Residual risks:**

- **API maturity.** The `node:sqlite` API is a release candidate, not yet stable. Breaking changes are possible between Node majors. Mitigations:
  - the runtime version is pinned by `bundled-node`;
  - all access goes through the `Store` port, so a swap to `better-sqlite3` is local.
- **No sqlite-vec loaded.** Vectors stay as BLOBs with a brute-force search (ADR 0003). Loading extensions in `node:sqlite` needs `allowExtension`, and that was not tested.
- **The bundled SQLite version follows Node releases.** It was 3.53.4 in 24.22.0. Record it in `emos doctor`.
- **Windows x64: pending the first CI run.** FTS5 is expected, because the official Node builds compile SQLite with the same options on every platform. This is not yet observed. See "Windows verification to run" in ADR 0001.

## Verification (2026-10-21)

- **WAL, migrations and online backup:** CI run `39520158278` passed the store-sqlite tests under Node 24 on `windows-latest` and `macos-14`.
- **FTS5:** pending. No automated test creates an FTS5 table yet. P1-00 adds one, so FTS5 availability is checked on every CI run.
