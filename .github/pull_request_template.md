## Task

<!-- e.g. P1-06 — link the board line in docs/plans/phase-N-*.md -->
Task: P?-??
Plan: docs/plans/phase-?-*.md

## What changed

## Checklist

- [ ] The task's board line is ticked `[x]` with `claim: done`, and all of its step checkboxes are ticked.
- [ ] `npm run ci` is green locally. CI is green on both macOS and Windows.
- [ ] Only files listed in the task's **Files** block changed, plus append-only registries.
- [ ] Every **Acceptance** bullet holds, except *(owner, after merge)* bullets, which are listed below.
- [ ] Fixtures and tests contain synthetic data only. There are no org names, internal hostnames, secrets or real people (`npm run check:fixtures`).
- [ ] If an ADR boundary changed: a new or superseding ADR is added and indexed in `docs/adr/README.md`. Choices inside an existing ADR's boundary are noted below.
- [ ] Interfaces match the plan exactly. Any mismatch is explained below rather than improvised.

## Decisions made within existing ADRs

## For the owner after merge

<!-- (owner, after merge) acceptance bullets, manual steps, anything needing real accounts -->
