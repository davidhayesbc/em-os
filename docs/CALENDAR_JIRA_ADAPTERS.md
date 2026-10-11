# Calendar and Jira review adapters

The Calendar and Jira adapters are separate, fixture-tested read paths into one review-queue contract. They do not expose create, update, comment, transition, or delete operations.

Safety contract:

- Each adapter has its own `enabled` switch and exact calendar/project allowlist.
- Every request carries a bounded UTC window and the previous incremental cursor. The cursor is committed only with the complete paginated batch.
- Responses that escape the requested scope, repeat a page token, exceed the page limit, omit timezone offsets, or contain non-HTTPS source links fail closed. HTTPS links containing userinfo are also rejected. Malformed URLs are reported with the field name, never as a raw `TypeError`.
- Calendar offsets are converted to UTC, including both sides of a DST fallback. Offset-free local timestamps are rejected as ambiguous.
- Permission errors name only the provider and allowlisted scope. No raw response, token, or credential is retained.
- Imported records always enter `proposed`; only the existing manager/audited review transition may approve them.
- Source deletions are propagated as tombstones. Retention deadlines are computed at ingestion.
- Exact source identity is stable (`calendarId:eventId` or `projectKey:issueId`). Ambiguous person matches produce a confirmation prompt and are never merged by display name. A single sub-threshold candidate still prompts for confirmation; identity resolution is configurable via `identityConfidenceThreshold` (default 1.0).
- Stable source URLs and all cross-source links are retained. Similar titles within seven days produce suggestions only; no automatic merge occurs. Dedup suggestions are computed against already-committed proposals, so similar items inside the same incoming batch are not cross-linked.

Windowing semantics:

- The `inWindow` filter applies to `occurredAt`. For Calendar, `occurredAt` is the event `start`; for Jira, `occurredAt` is the issue `updatedAt`. A Calendar event whose start lies outside the window but that changed within the window is silently dropped. Source deletions are not window-filtered and are always propagated.

Storage integration:

- `SqliteReviewQueueStore` implements the `ReviewQueueStore` contract on top of `SqliteStorage`. It writes source records, `review_queue_proposals`, `sync_cursors`, and `deletion_tombstones` inside a single transaction.
- `ReviewDeletion` carries a `contentHash` so the tombstone can satisfy the `deletion_tombstones.content_hash` NOT NULL constraint.
- `AdapterCommit` carries `fetched`, which is mapped into `sync_cursors.fetched_count`. `last_error` is cleared on a successful commit and `last_success_at` is set.

The checked-in fixtures are synthetic and deliberately cover pagination, update/delete deltas, timezone/DST offsets, identity ambiguity, and cross-source links. Permission behavior is generated in unit tests so no credential-shaped data is committed.
