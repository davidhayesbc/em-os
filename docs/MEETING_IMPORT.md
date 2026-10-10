# Meeting-note local import and review queue

Status: synthetic/local prototype. No MCP or Claude route is enabled. The approved local-file adapter is the only active path until the discovery and security gates authorize a bounded Claude/MCP route.

## Input contract

The adapter accepts an absolute file path only when its canonical path is inside an explicitly configured approved root. Approved roots and imported files are resolved through the same platform canonicalizer before comparison, including symlink resolution and macOS/Windows path-namespace normalization. Configured roots must exist and be resolvable. It reads the file once and recognizes these line-oriented Markdown markers:

- `- ACTION: [owner=Manager; due=2026-10-12] Review the launch checklist`
- `- DECISION: Use the staged rollout`
- `- EVIDENCE: [subject=Person A] Documented the rollback plan`

Each proposal receives a stable document identifier, local document URI, line anchor, and a bounded quote. Email addresses and common inline secret assignments are redacted before proposal fields or quotes reach the queue. Unmarked note text is not copied. The full note/transcript is never retained by the adapter.

## Trust and review boundary

Every extracted item enters `MeetingReviewQueue` in `proposed` state. Extraction cannot create an approved record. A manager may:

1. edit proposed fields while immutable source provenance remains attached;
2. accept with reviewer identity, reason, and UTC timestamp;
3. reject with reviewer identity, reason, and UTC timestamp; or
4. resolve a lexical duplicate suggestion as `merge` or `separate` before acceptance by supplying a nonblank actor identity with the `manager` role.

Similarity is advisory only. Ambiguous matches block acceptance until an authorized manager decides; the implementation never silently merges commitments. Both merge and separate resolutions retain the manager actor identity and role on the proposal as an audit record. An empty identity or any non-manager role leaves the duplicate unresolved and acceptance blocked. Approved and rejected proposals are immutable.

## Failure behavior

- paths outside approved roots fail closed;
- missing anchors/quotes cannot enter the queue;
- permission, missing-file, and offline errors return typed, content-free errors;
- failures enqueue no proposal and log no note content;
- files with no recognized anchored proposals fail without retaining their text.

Direct MCP and Claude-mediated imports remain disabled. Enabling either requires the separately documented security approval, fixed read-only tool scope, schema-pinned output, sanitized environment, and no raw prompt/tool logging.

## Verification

Run `npm run clean && npm run ci`. Unit coverage includes synthetic notes, absent anchors, edits, duplicate ambiguity, rejection, redaction, unapproved paths, permission/offline errors, and notes without proposals.
