# Commitment follow-up semantics review

This review exercises the current commitment entity, state machine, and audit contract with synthetic data only. The executable inventory is
[`follow-up-scenarios.test.ts`](../../packages/core/src/commitments/follow-up-scenarios.test.ts).

## Scenario results

| Scenario | Assessment | Current behavior and gap |
|---|---|---|
| promise vs intention | **Requires a product decision** | Both statements fit the same commitment shape. The model has no speech-act field and cannot explain whether “I plan to…” should become a commitment. Decide the capture rule before adding classification. |
| undated promise | **Supported** | An active commitment may have `due: null`; it remains actionable without inventing a date. |
| repeat reminder without duplication | **Unsupported** | A reminder/follow-up has no identity, provenance, recipient/channel, delivery state, or deduplication key. Repeating one cannot be represented separately from editing the commitment or appending an unstructured audit note. |
| incomplete delivery | **Requires a product decision** | The commitment can remain active, but there is no structured partial-fulfilment fact. Decide whether a partial delivery is an interaction, a child commitment, or structured progress before defining completion behavior. |
| deadline renegotiation with original promise retained | **Supported** | An `edit` keeps the commitment ID and title. Repository audit events record the `due` diff (`from` and `to`), retaining the original deadline as mutation history. The conversation that caused the change is not represented. |
| trigger-based obligation | **Unsupported** | `due` represents a local calendar date/time only. A phrase such as “when the launch is approved” can survive only as title/notes, with no structured trigger state or firing provenance. |
| a completed commitment resurfacing in sync | **Supported** | `done` is terminal for ordinary edits; only an explicit reopen can return it to `active`. The repository additionally rejects import/system attempts to leave a terminal state, so resurfacing source material does not silently reopen it. It may still be useful as a separately recorded observation. |

## Is `audit_events` sufficient?

No. `audit_events` is sufficient for operational mutation history: who changed the stored commitment, when, the action, and field-level `from`/`to` values. It is not a user-facing history of reminders or conversations:

- it is emitted only when an entity is created or saved, so an observed message that causes no mutation has no natural audit event;
- its actor identifies the writer (`user`, `import`, `system`, or `mcp`), not sender, recipient, channel, or connector account;
- it has no source-item/span provenance, delivery state, external identity, causal link, or deduplication key;
- overloading `action` or `note` would mix operational evidence with unverified domain observations and would not make retries idempotent;
- an audit row belongs to one entity mutation, while a conversation may mention several commitments or no accepted commitment at all.

`audit_events` should remain the immutable operational mutation log. A user-facing timeline should join those mutations with separately modelled follow-up observations/interactions.

## Proposed interaction/event model (not implemented)

If the owner approves a separate model, use a neutral entity such as `commitment_interaction` rather than widening `audit_events`.

### Shape

- stable interaction ID;
- commitment ID plus optional source item ID and exact source span;
- kind: at minimum `reminder`, `response`, `partial_fulfilment`, `renegotiation`, `trigger_observed`, and `completion_observed`;
- direction, sender person ID, recipient person IDs, channel/connector identity, and occurred/captured timestamps;
- lifecycle state and optional supersedes/duplicate-of relationship;
- structured payload specific to the kind (for example proposed due date or a bounded progress description), while retaining the source evidence;
- creation provenance (`user`, `import`, `mcp`, or extractor/model job), confidence where machine-proposed, and the accepting user/action where applicable.

### Lifecycle

1. `proposed`: machine-observed interactions await review and cannot mutate a commitment.
2. `accepted`: user-confirmed fact shown in the timeline; acceptance may separately invoke an existing commitment transition/edit.
3. `rejected`: retained as a triage decision for provenance/dedup but not shown as factual history by default.
4. `superseded`: replaced by a corrected/merged interaction, linked to its successor rather than rewritten.

Manual interactions may be accepted at creation. Connector retries must be idempotent. No interaction, including a completion observation, may silently reopen or complete a commitment.

### Provenance and deduplication

1. Prefer a connector-scoped immutable external event/message ID; uniqueness is `(connector account, external ID, source span, kind)`.
2. For sources without stable IDs, compute a versioned fingerprint from source item ID, normalized exact span, kind, direction, participants, and occurred-time bucket. Store the fingerprint inputs and algorithm version.
3. An exact-key retry returns the existing interaction and does not add another timeline item or audit event.
4. Similar but non-identical observations are merge proposals, never automatic destructive merges. A merge links `duplicateOf`/`supersedes` and preserves every source.
5. Deduplicate interactions independently from commitments. Several legitimate reminders may refer to one commitment; one repeated source observation must not create several reminders.
6. Accepting an interaction and changing a commitment are separate, atomic operations linked causally: the interaction records evidence; the audit event records the mutation.

## Owner decisions required

1. **Promise boundary:** Which explicit intentions count as commitments, and must ambiguous statements always remain proposals?
2. **Partial fulfilment:** Is progress an interaction only, a structured quantity, or decomposition into child commitments? What, if anything, can mark the parent done?
3. **Trigger semantics:** Which trigger types are allowed, who evaluates them, and does trigger observation activate, propose, or merely annotate an obligation?
4. **Interaction entity:** Approve a distinct entity/timeline rather than overloading `audit_events`, including its name and minimum kinds.
5. **Lifecycle:** Approve `proposed → accepted/rejected`, supersession, and the rule that machine observations never mutate terminal commitments without user action.
6. **Provenance/privacy:** Define required source span, participant/channel visibility, connector retention, and treatment of deleted source content.
7. **Deduplication:** Approve exact external-ID/fingerprint idempotency and human-reviewed semantic merges, including fingerprint versioning and time buckets.
8. **Causality:** Decide whether accepting an interaction and applying an existing edit/transition must be one atomic command with reciprocal links.
9. **ADR/spec follow-up:** If approved, schedule a separate schema/API/spec task and owner-reviewed ADR. That ADR must supplement or, where it changes pipeline triage/dedup rules, explicitly supersede the affected portion of accepted ADR 0007; this task does not edit ADR 0007.

No accepted ADR is changed by this review, and no schema, API, or interaction model is implemented here.
