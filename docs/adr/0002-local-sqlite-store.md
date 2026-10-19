# ADR 0002: Local SQLite store

- **Status:** Accepted; driver chosen by Phase 0 spike
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
