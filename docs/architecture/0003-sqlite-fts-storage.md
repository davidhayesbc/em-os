# ADR 0003: SQLite and FTS5 storage

- Status: Accepted with driver gate
- Date: 2026-10-09
- Spec: `docs/PRODUCT_SPEC.md` §§6, 9–10, 14

## Context

EM OS is local-first and single-user. It needs relational invariants, migrations, lexical search, provenance, retention/deletion, and encrypted backup/restore. Native SQLite bindings can fail across Node/VS Code ABIs and target platforms.

## Decision

Use one SQLite database per local profile, in ADR 0007's app-data directory, with foreign keys enabled, WAL where policy/filesystem support it, busy timeout, integrity checks, and versioned forward migrations. Use built-in FTS5 for permitted lexical fields only. Do not add vectors, Postgres, or an external memory service in MVP.

The schema implements the minimum entities in `PRODUCT_SPEC.md` §6. Required invariants include:

- unique `(provider, source_id)` and stable local IDs;
- UTC storage plus source timezone metadata where presentation requires it;
- source record, allowed excerpt/digest, content hash, classification, observed/occurred/last-seen timestamps, and deletion state;
- many-to-many provenance for actions/evidence/drafts;
- append-only audit/correction events for approval, merge, snooze, completion, rejection, and supersession;
- sync page writes and cursor/watermark advancement in one transaction, after validation; failed pages never advance cursors;
- deletions remove policy-covered excerpts and FTS/cache rows and retain only an allowed audit tombstone;
- FTS is a rebuildable projection, not authoritative data.

Search APIs always enforce classification/scope before constructing results. Parameterized SQL only. Connections and migrations are owned by the storage adapter; callers cannot issue arbitrary SQL.

## Native-driver decision criteria

Gate `G-DB-01` compares at least one maintained native Node binding and one WASM-backed alternative using the same tests. Record exact version/license/advisories and evaluate: Node/VS Code ABI, FTS5 presence, transactions/savepoints/foreign keys, migration support, backup API, concurrent CLI/extension access, performance on realistic synthetic multi-month data, package size/startup, postinstall/download behavior, macOS arm64 notarization/signing impact, Windows x64 install and long paths, offline installation, maintenance, and encryption compatibility. Prefer the simplest maintained option passing all hard requirements; performance is secondary at MVP scale.

SQLCipher/application-level encryption is not presumed. Gate `G-SEC-02` chooses OS full-disk protection versus application DB encryption from the approved threat model. Until approved, sensitive ingestion is prohibited.

## Alternatives considered

- JSON/files only: rejected for transactional cursor/idempotency and relational/audit needs.
- Postgres/pgvector: rejected as unnecessary service and packaging complexity.
- Vector extension/embeddings: deferred until a synthetic task benchmark proves FTS5 insufficient and model/version/reindex rules exist.
- Store DB in the repository or git-sync it: rejected as a confidentiality and corruption risk.
- Choose a native driver now: rejected until the target matrix is exercised.

## Consequences

SQLite provides portable local transactions and rebuildable search. Driver selection remains blocked but repository interfaces and migrations can be built against contract tests. WAL/backups and concurrent processes require explicit coordination. FTS copies text, so retention/deletion must cover both authoritative and indexed rows.

## Test implications

- Migration up, rollback/recovery policy, foreign-key and schema-version tests.
- Repeated/paginated sync, duplicate/upsert, deletion, cursor rollback on failure, and completed-item non-reopen tests.
- FTS insert/update/delete/rebuild and classification filtering tests.
- Crash/interruption, concurrent access, backup/restore/integrity and retention tests.
- Identical driver contract suite on macOS arm64 and Windows x64 with synthetic data only.
