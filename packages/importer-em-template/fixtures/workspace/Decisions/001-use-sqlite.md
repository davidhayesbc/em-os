# Decision: Use SQLite for local-first store

## Context

- Need embedded, zero-config storage for the desktop client.

## Decision

- Adopt SQLite via `better-sqlite3`.

## Consequences

- Simpler backups, single-file database.
