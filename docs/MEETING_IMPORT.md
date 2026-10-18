# Meeting-note import adapter

Status: **synthetic-only prototype**. No real meeting-data transport, MCP route, or credential is included. Real file ingestion remains fail-closed pending owner/security approval in the work environment.

## Boundary

`MeetingNoteReviewQueueAdapter` accepts only a separately configured absolute `approvedRoot` and an explicit `allowedLabels` list. Each sync targets exactly one relative document label (for example `notes/team.md`). Labels that are not allowlisted, contain path traversal, start with an absolute path, or include path metacharacters are rejected before any page is requested.

The transport is an injected `MeetingNotePageSource`; production code cannot silently select a network route. Its request carries only the stable hashed document id, the relative document label, the approved UTC window, and a bounded page size. Responses use a strict versioned DTO, reject unknown fields, cap pages at 200 items, cap titles at `maxTitleChars` (an optional override that defaults to 200), cap bodies at `maxBodyChars` (an optional override that defaults to 1000), and persist only after the response `documentId` and `documentLabel` match the requested values. Pagination is bounded to 200 items per page, 100 pages per sync, and 20_000 total items per sync. Constructor overrides may lower the per-sync page or total-item cap, but must be finite positive integers no greater than those respective hard limits; invalid cap configuration is rejected before any page is requested. A stored cursor is used as the first request cursor; when a successful terminal page has no `nextCursor`, the stored cursor is explicitly cleared so the next sync starts with `undefined`.

The adapter redacts email addresses and secret-like assignments from titles and bodies before persistence. Covered forms are quoted, backtick-quoted and unquoted assignments of `api_key`, `apikey`, `access_token`, `auth_token`, `client_secret`, `password`, `passwd`, `secret` or `token`, where the value is 8 or more characters and is not an obvious placeholder. Free-form high-entropy tokens that are not in an assignment form are not detected. No absolute local path is stored in provenance: the source record uses the stable hashed document id plus the relative label, and the source URL is a synthetic `https://example.invalid/meeting-notes/<label>` placeholder.

## Persistence and review

A successfully completed sync atomically persists:

- source records with meeting-note provider identity, stable hashed source id, synthetic source URL, timestamps, redacted excerpt/content hash, scope classification (`work` or `confidential`), and retention deadline;
- deletion propagation for deleted notes, including a content-free tombstone keyed by a hash of the redacted title/body and removal of unreviewed proposals;
- action or decision proposals in `review_queue_proposals`, always initially `proposed`;
- the next pagination cursor as the incremental high-water mark, or `undefined` when the source reports no next page.

A failed page commits neither records nor cursor. A successful terminal page clears the cursor; if a source supplies a `nextCursor`, that value is stored for the next sync. Stable source identity (`documentId:itemId`) makes updates and replay idempotent. Approved/rejected proposals are terminal and require the existing audited review transition; connector replay cannot auto-approve or overwrite a reviewed proposal.

Meeting-note text is inert data. The adapter does not interpolate it into commands or prompts. The adversarial synthetic fixture deliberately includes an email address and a secret-assignment pattern and verifies that both are redacted to `[REDACTED-EMAIL]` / `[REDACTED-SECRET]` in stored output.

## Synthetic verification

The fixture `fixtures/connectors/meeting-notes.synthetic.json` covers pagination, an updated action, a deleted decision, provenance, and adversarial redaction. Tests also verify scope escape, DTO strictness, repeated cursor detection, pagination and memory bounds, second-sync idempotency, transactional persistence, and classification propagation.

Run:

    npm ci
    npm run clean
    npm run ci

No test needs a real file path or network connection. Before implementing a real `MeetingNotePageSource`, obtain approval for the exact approved root, allowed labels, retention/classification policy, credential store, file-watching behavior, and work-environment-only integration test. Do not add broad file-system traversal or write methods to this adapter; they require a separate security-reviewed design.
