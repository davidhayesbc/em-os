# Read-only PR connector

Status: synthetic fixture implementation. Real work-data ingestion is disabled until the discovery and security gates in `SECURITY_CONNECTOR_DISCOVERY.md` are approved in the work environment.

## Ingress and scope contract

- Direct MCP is fail-closed because discovery did not approve its transport or schema. The connector accepts only the in-process `synthetic-fixture` transport and a separately approved `approved-claude-runner` transport.
- The runner boundary is a fixed `fetchPage` operation. Every request carries exactly `pull_requests:read`; write/admin scopes are rejected. Repositories must be explicit `owner/repo` allowlist entries.
- Responses use schema version 1, reject unknown fields, and bound each page to 50 records, each sync to 20 pages, text fields to documented parser limits, and retries to three.
- Only stable absolute HTTPS source URLs without credentials or fragments are accepted. A URL must identify the requested repository and PR source ID.
- Source text is data only. The DTO has no prompt, command, token, credential, comment-body, or write field.

## Fixture and approved-work probes

`fixtures/connectors/pr-pages.synthetic.json` is fabricated and contains no recorded work response. Core tests load it through `synthetic-fixture`, replace global `fetch` with a failing sentinel, and prove the fixture path makes no network request.

An approved-work probe, when security and the source owner authorize one, must be run outside public CI with the narrow Claude runner and a non-sensitive repository. Configure only the approved repository and `pull_requests:read`; request one bounded page; verify schema version, stable URLs, pagination cursor, delta watermark, permission behavior, rate-limit metadata, and offline behavior. Do not save raw responses, credentials, titles, author names, or source content in this repository. Record only a redacted pass/fail gate decision. Until that approval exists, do not instantiate an `approved-claude-runner` against work systems.

## Reconciliation and failure behavior

Each page is schema-validated and deduplicated before `PrSyncStore.commitPage`. The store contract atomically upserts changed PRs, applies deletion tombstones, and advances the page cursor. A failed commit therefore leaves both data and cursor unchanged. The next request uses a pagination cursor when present, otherwise the committed delta watermark. Updated records overwrite the same source ID; deletions remove it idempotently.

Permission, rate-limit, offline, schema, configuration, and transient failures are returned in the repository sync result and persisted through `recordFailure`. Retryable transport errors use a bounded retry budget; permission and schema failures are never retried. Existing records and cursors are not cleared on failure. A later successful sync clears the visible failure state.

## Verification

Run `npm test`. `pr-connector.test.ts` covers pagination, duplicates, updates, deletion, transactional cursor behavior, bounded retry, permission denial, offline operation, schema drift, route/scope/repository enforcement, and a no-network fixture run.
