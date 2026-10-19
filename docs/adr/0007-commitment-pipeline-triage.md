# ADR 0007: Commitment pipeline — propose, triage, learn

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§5.3, 7.2–7.4

## Context

Todo lists fed from many sources become noisy and get ignored. The user would rather miss something than flood the list, but they need fast triage that teaches the tool. Machine proposals come from chat, email, meeting notes, done detection, decay, brag-doc discovery and MCP clients.

## Decision

- **Everything machine-made lands in triage as `proposed`.** Only the user's own UI entries skip triage. Per-source auto-accept is opt-in.
- **Scope:** only commitments *by* the user (`mine`) or *to* the user (`owed_to_me`). Other people's action items stay attached to the meeting or thread.
- **Pipeline:**
  1. fetch;
  2. deterministic pre-filter (suppress and exclusion rules, lookback window, bots);
  3. structured extraction (model job `commitment.extract`), with few-shot examples retrieved from past triage decisions;
  4. identity resolution — unknown people are surfaced, never auto-created;
  5. dedup by counterpart + embedding similarity + due window, which produces "merge into";
  6. proposal.
- **Triage actions:** accept (with edit), merge, snooze, or reject with a reason chip. Each decision is stored and embedded.
- **Learning** (retrieval-based, no fine-tuning):
  - few-shot retrieval of past decisions;
  - per-scope accept-rate tracking, with a suggested suppress rule when a scope has ≥ 8 decisions and < 20% acceptance (the user confirms);
  - adaptive per-connector confidence thresholds, with low-confidence items collapsed.
- **Done detection and decay** only produce proposals. Re-sync never reopens done or dropped items.
- **Metric:** triage accept rate per connector, shown in settings, with a target of ≥ 70% after two weeks.

## Alternatives considered

- **Auto-adding everything above a confidence threshold:** rejected as the default, because it's the noise failure mode.
- **Rules-only (regex) extraction:** rejected as the primary method. It's low recall and brittle, though kept as a pre-filter signal.
- **Fine-tuning a classifier:** deferred. Few-shot retrieval gets most of the benefit without training infrastructure.

## Consequences

Triage UX must be keyboard-fast. Quality ramps up over the first weeks. A seed set of synthetic decisions helps the cold start.
