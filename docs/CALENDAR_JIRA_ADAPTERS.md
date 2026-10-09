# Calendar and Jira review adapters

The Calendar and Jira adapters are separate, fixture-tested read paths into one review-queue contract. They do not expose create, update, comment, transition, or delete operations.

Safety contract:

- Each adapter has its own `enabled` switch and exact calendar/project allowlist.
- Every request carries a bounded UTC window and the previous incremental cursor. The cursor is committed only with the complete paginated batch.
- Responses that escape the requested scope, repeat a page token, exceed the page limit, omit timezone offsets, or contain non-HTTPS source links fail closed.
- Calendar offsets are converted to UTC, including both sides of a DST fallback. Offset-free local timestamps are rejected as ambiguous.
- Permission errors name only the provider and allowlisted scope. No raw response, token, or credential is retained.
- Imported records always enter `proposed`; only the existing manager/audited review transition may approve them.
- Source deletions are propagated as tombstones. Retention deadlines are computed at ingestion.
- Exact source identity is stable (`calendarId:eventId` or `projectKey:issueId`). Ambiguous person matches produce a confirmation prompt and are never merged by display name.
- Stable source URLs and all cross-source links are retained. Similar titles within seven days produce suggestions only; no automatic merge occurs.

The checked-in fixtures are synthetic and deliberately cover pagination, update/delete deltas, timezone/DST offsets, identity ambiguity, and cross-source links. Permission behavior is generated in unit tests so no credential-shaped data is committed.
