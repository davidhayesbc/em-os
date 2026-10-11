# ADR 0007: Local data paths, failures, and offline behavior

- Status: Accepted with policy gates
- Date: 2026-10-09
- Spec: `docs/PRODUCT_SPEC.md` §§2, 5–7, 9–10, 12, 14

## Context

Local-first means independent local instances and honest operation without network; it does not mean no egress. Data must never default into the public checkout. Connector/model failures must not corrupt prior state or present stale data as current.

## Decision

Resolve a per-user application-data root through a `DataPaths` port:

- macOS default: `~/Library/Application Support/EM OS/`;
- Windows default: `%LOCALAPPDATA%\EM OS\` unless corporate backup/roaming policy selects `%APPDATA%`;
- tests: an explicit isolated temporary root outside the checkout;
- Linux development: `${XDG_DATA_HOME:-~/.local/share}/em-os/` (not an MVP support commitment).

Subdirectories separate `db/`, `backups/`, `cache/`, and redacted operational `logs/`. Credentials are never stored there: adapters receive opaque handles from an approved OS credential store/Locker. Foam workspace and export locations are explicit user-selected paths, not children of the code repository by default. The app rejects or requires a conspicuous development-only override for DB, backup, cache, log, prompt, transcript, export, or work-note paths inside a Git checkout. Config contains paths, allowlists, thresholds, and route aliases only—no tokens or actual people/work fixture data.

Gate `G-PATH-01` confirms canonical Foam paths, Windows eligibility for work data, application-data/backup locations, ACL/profile separation, and retention. Gate `G-SEC-02` confirms FileVault/BitLocker, encrypted backup/restore, and whether application-level DB encryption is required.

Each source has independent health state: never-synced/syncing/fresh/stale/error/offline/permission-blocked/schema-blocked, last attempt, last successful observation, and redacted error. A failed source does not erase its last durable snapshot or block unrelated connectors. UI/CLI always show age and failure next to cached results; stale data is never worded as current. Partial page writes roll back and cursors do not advance. Retries are bounded, cancellable, classified, and never applied to policy/permission/schema errors without intervention.

Offline mode performs no network calls, supports cached read/query, deterministic ranking with freshness penalties/banners, manual action state changes, and local draft editing. Model-dependent generation reports unavailable and offers a manual/cached-input draft shell; it never silently changes routes. Background operation is not promised: MVP manual/extension-open sync is explicit. Future scheduling requires a durable independent host and separate tests.

Backups use a consistent SQLite backup operation, encrypted approved destination, manifest/schema version, and restore drill. Do not git-sync DBs or sensitive Markdown. Cross-device instances are independent.

## Alternatives considered

- Store data under workspace/repository: rejected for public-repo leakage.
- Hide stale/error state and serve cache: rejected because it misrepresents reality.
- Clear cache on connector errors: rejected as destructive and harmful offline.
- Unlimited retries or fallback provider: rejected for rate-limit, egress, and policy risk.
- Promise always-on VS Code timers: rejected because hosts sleep/close and timers are not durable.
- Automatic cross-device git sync: rejected for confidentiality and SQLite conflicts.

## Consequences

Users get useful offline behavior and explicit trust signals. Corporate path/encryption decisions remain release gates. Path portability and permissions require target-OS testing. Operational logs must be useful while excluding work content and secrets.

## Test implications

- Path tests cover both target OS conventions, Unicode/spaces/long paths, checkout rejection, permissions, and no-secret config serialization.
- Offline/no-network tests prove cached triage and local actions work and model/connectors fail visibly.
- Failure tests cover rate limit, permission, schema drift, timeout, cancellation, partial page rollback, independent connector isolation, and freshness transitions.
- Backup/restore tests verify manifest, integrity, the `em-os-enc-backup` envelope contract (header-AAD and validated-field-set/rejection rules per ADR 0008 §Decision item 3), and deletion state.
- Log snapshots use synthetic identifiers and assert tokens, prompt/source bodies, and personnel content are absent.
