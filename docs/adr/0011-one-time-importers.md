# ADR 0011: One-time importers

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§11, 12

## Context

New users arrive with history in personal notes systems: Markdown or Foam workspaces, Obsidian vaults, docs and todo files. That history is valuable for profiles, Ask and promotion packages, but ongoing two-way sync with a notes system is fragile. Some importers will only ever matter to one user.

## Decision

- **Interface:** an importer implements `import(source, {dryRun}) → report`. It is **one-time**. Re-running is supported only to fix a bad import, and is idempotent via a stable key per imported unit (source path + section + content hash, or a native id where the source has one).
- **Dry run first:**
  - counts per entity;
  - proposed person merges;
  - unknown pronouns;
  - items to activate vs archive;
  - unparseable content, reported and never silently dropped;
  - org-specific values found in the source (roster, handles, repos, meeting title patterns), proposed as EM OS config for the user to confirm.
- **Dates:** original dates are preserved as `occurred_at`. Undated content uses the file's history or modified time.
- **Sensitivity:** known sections map to sensitivity levels (e.g. career, wellbeing, feedback and contribution notes → `people_sensitive`).
- **Todo activation:**
  - done items import as history;
  - open items owned by or owed to the user, which are dated, prioritised or recently touched, import as `active`;
  - everything else imports as `dropped` with `drop_reason = archived_on_import`, still searchable and restorable.

  An **import review** screen (Phase 1) lists the active set for bulk keep/drop before it feeds ranking. Because the import is user-initiated and reviewed, that review counts as the user's approval, and imported items don't go through the Phase 2 triage inbox.
- **Read-only on the source:** importers never modify the source.
- **Personal importers may be ephemeral.** An importer written for one user's workspace format lives in `importers/` while needed, is tested against a synthetic fixture shaped like that format, and may be deleted after use. Its format notes live beside it, not in the product spec.

## Alternatives considered

- **Live two-way sync with Markdown:** rejected. It's fragile, and it keeps structure in prose.
- **No import:** rejected. History is the most valuable input for profiles and evidence.

## Consequences

Importers must tolerate format drift and report what they couldn't parse. The generic interface keeps the door open for common formats (Obsidian, Notion export) later.
