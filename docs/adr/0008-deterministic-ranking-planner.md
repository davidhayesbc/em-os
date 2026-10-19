# ADR 0008: Deterministic, explainable ranking and planner

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§5.1, 7.5

## Context

"Do these 5" is the centre of the product. The user prioritises time-critical work first (e.g. slides for a meeting today or tomorrow), then hard-dated commitments. Goals must not be crowded out by urgency. Trust requires that the order is stable and that the reason for it is visible.

## Decision

- **Ranking:** `rank(snapshot, clock, config)` is a pure function. Its score components, in priority order:
  1. time-critical (meeting prep within ~24h; due today or tomorrow);
  2. hard-dated (proximity, overdue boost);
  3. waiting on me (age: PR review requests, owed replies, my tickets blocking others);
  4. goal advancement (N reserved slots, default 1);
  5. pin / priority;
  6. penalties (snoozed, low confidence, stale source).

  Weights live in config. Ties break by due date, then `captured_at`.
- **Tickets assigned to me** become candidates only when due soon, blocking others, or pinned.
- **Explanation:** each item gets a *why* chip for its dominant component, with the full breakdown in a tooltip. A debug view lists every scored item for tuning.
- **Planner:** `plan(ranked, calendar, config)` is a pure function. It finds free blocks (≥ 15 minutes, within working hours) and greedily places items by rank × effort fit. It flags unplaceable items and never edits the calendar.
- **Models** only narrate the plan (`plan.narrate`). They can't add, drop or reorder items.

## Alternatives considered

- **Letting an LLM pick the 5:** rejected. It's non-deterministic, unexplainable, and doesn't work offline.
- **Due-date sort only:** rejected. It ignores meeting prep, waiting-on-me items and goals.
- **An Eisenhower matrix as the primary UI:** rejected. It's more taxonomy to maintain.

## Consequences

Ranking quality depends on good due dates and meeting links, so capture must get them right. The weights will need tuning on real data.
