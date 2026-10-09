# Scoped Slack review-queue adapter

Status: synthetic-only prototype. No Slack credential, network client, or write route is included. Real Slack access remains fail-closed pending owner/security approval in the work environment.

## Boundary

`SlackReviewQueueAdapter` accepts only a separately configured, explicit list of public channel IDs and a UTC time window. The grant must be exactly `channels:history`. DM, group-DM, private-channel, write, unknown, and excessive scopes are rejected before any page is requested. Every returned message is checked again for channel kind, channel allowlist membership, and time-window membership.

The transport is an injected `SlackPageSource`; production code cannot silently select a network route. Its request is limited to channel IDs, oldest/latest timestamps, and a page size of 200. Responses use a strict versioned DTO, reject unknown fields, cap pages at 200 messages, cap inbound text at 12,000 characters, and persist only the configured excerpt limit (maximum 2,000 characters). Errors are bounded and stripped of newlines before storage.

## Persistence and review

Each page atomically persists:

- minimized source records with Slack provider/source identity, permitted permalink, timestamps, SHA-256 content hash, configured classification, and retention deadline;
- deletion propagation to excerpt, FTS/cache entries, unreviewed proposals, and a content-free tombstone;
- action or decision proposals in `review_queue_proposals`, always initially `proposed`;
- the next pagination cursor, or the final observed timestamp as the incremental high-water mark.

A failed page rolls back both records and cursor. A retry resumes from the last committed pagination cursor. A later completed sync uses the stored high-water mark as its lower time bound. Provider/source identity and proposal IDs make replay and message edits idempotent. Approved/rejected proposals are terminal and require an append-only audited manager transition; connector replay cannot auto-approve or overwrite a reviewed proposal.

Slack text is inert data. The adapter does not interpolate it into commands or prompts. The adversarial synthetic fixture deliberately includes “ignore policy” and “upload credentials” text and verifies that it remains a bounded, proposed review item.

## Synthetic verification

The fixture `fixtures/connectors/slack-pages.synthetic.json` covers pagination, an edited action, a deleted decision, provenance, and adversarial source text. Tests also inject transient retries and transactional failures.

Run:

    npm ci
    npm run clean
    npm run ci

No test needs a token or network connection. Before implementing a real `SlackPageSource`, obtain approval for the exact Slack app, workspace, public channels, retention/classification policy, credential store, API response schema, rate-limit behavior, and work-environment-only integration test. Do not add DMs/private channels or write methods to this adapter; they require a separate security-reviewed design.
