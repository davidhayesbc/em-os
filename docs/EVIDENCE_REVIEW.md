# Evidence and review packets

The core `EvidenceReviewService` implements the human-approved evidence boundary described in PRODUCT_SPEC sections 5, 6, 9 and 10.

## Rules

- New records are always `proposed`; only an explicit actor/reason transition can approve, reject, or supersede them. The transition and reason are append-only audit events.
- Records carry subject, competency, observation, impact, context, observed date, source record plus document anchor, consent, and author. Corrections create a new proposed record with `supersedesId`; the prior record is not edited in place.
- A packet requires a supplied target-level rubric. Missing competencies appear as gaps. Claims can only cite approved evidence IDs and retain a source anchor. An unavailable source is represented as `available: false` with local provenance; no URL is invented.
- Packets contain claims, gaps and counter-evidence only. The service has no rating, score, promotion-readiness, or person-note injection operation. A packet is not exportable until a named reviewer signs it.
- Sensitive export requires an authorization decision and writes an audit event. Deletion removes the record from future retrieval, scrubs its packet references, invalidates sign-off, and leaves a deletion tombstone audit event.

The module is deliberately persistence-neutral. A SQLite adapter can map these append-only events to the existing `review_audit` and deletion-tombstone tables without weakening the domain checks.
