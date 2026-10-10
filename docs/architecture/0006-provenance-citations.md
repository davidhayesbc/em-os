# ADR 0006: Provenance, evidence, and citations

- Status: Accepted
- Date: 2026-10-09
- Spec: `docs/PRODUCT_SPEC.md` §§4–7, 9–10

## Context

The product's trust claim depends on source-backed recommendations and drafts. A syntactically valid citation is not semantic truth. Personnel evidence is more sensitive than ordinary work events and must remain human-curated.

## Decision

Every imported fact begins as a `source_record` with provider/source ID, stable URL or permitted document anchor, classification, content hash, occurred/observed/last-seen timestamps, allowed excerpt/digest, and deletion/retention state. Derived records carry explicit typed edges to one or more source record IDs and a derivation/review state.

Keep these categories distinct:

- source observation: immutable imported metadata/excerpt;
- proposal/inference: untrusted until reviewed;
- approved fact/evidence: manager-approved with approver/time;
- interpretation: explicitly labeled and never rewritten as observation;
- draft claim: generated output tied to its exact input set.

A `Citation` contains local record ID and, only when permitted and real, stable source URL/anchor. The citation validator rejects a substantial generated claim unless every cited ID exists, was approved where the workflow requires approval, was included in that generation run's input IDs, satisfies audience/classification policy, and is not deleted/superseded beyond policy. An inaccessible source retains local provenance and renders `source unavailable`; it never receives a fabricated URL.

Draft files include reviewable citation markers and an evidence/input manifest. Validation failure prevents “ready for review” state but preserves a clearly invalid draft for correction if policy allows. Human approval remains mandatory because validators cannot prove semantic entailment. Evidence merge preserves all source edges; identity ambiguity never merges by display name alone. Proposed evidence never auto-enters person notes or review packets.

Corrections append audit events and supersede old derived records rather than rewriting history. Deletion follows policy across excerpts, FTS, caches, and future draft inputs; generated artifacts containing deleted content are flagged for regeneration/deletion. Audit tombstones retain only policy-approved metadata.

## Alternatives considered

- URLs embedded directly in prose only: rejected because links can be fabricated, inaccessible, or detached from input sets.
- Trust model-generated citations: rejected because models can invent IDs/URLs.
- Mutable “latest truth” rows without audit: rejected because corrections and approvals become untraceable.
- Treat all imported notes as facts: rejected; arbitrary Foam/source text is not verified.
- Infer personnel performance from activity counts: rejected by product and privacy constraints.

## Consequences

Users can inspect why a claim exists and distinguish observation from interpretation. Storage and UI must support many-to-many edges, review states, and invalidation. Deletion and export are more involved because derived artifacts must be traced.

## Test implications

- Reject missing, invented, out-of-input, unapproved, deleted, superseded, and classification-incompatible citations.
- Render inaccessible sources as `source unavailable` without inventing links.
- Preserve all provenance after dedup/merge and retain immutable correction history.
- Prove proposed evidence cannot enter approved packets or generated claims requiring approval.
- Deletion tests cover authoritative rows, FTS/cache, draft invalidation, and allowed tombstones.
- Synthetic end-to-end draft maps each substantial claim to its exact approved inputs.
