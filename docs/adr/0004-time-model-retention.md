# ADR 0004: Time model, retention and exclusion

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§7.1, 7.6, 7.8

## Context

Everything an EM collects ages:

- chatter from a year ago is noise;
- a decision from a year ago may still matter;
- some sources or periods should be excluded entirely.

The user wants every item dated, so it can be aged out or excluded, and wants retrieval to filter by date *before* semantic search.

## Decision

- **Common time fields** on every entity:
  - `occurred_at` — when it happened, from the source;
  - `captured_at` — when EM OS learned of it;
  - `updated_at`.

  Records without a natural date use `captured_at` as `occurred_at`. Importers preserve original dates.
- **Living documents** (brag docs, design docs) are split into sections. Each section is dated from a parsed heading or bullet date, falling back to its first-seen time. Edited sections become new dated versions.
- **`retention_state`** on every record and chunk:
  - `active`;
  - `archived` — hidden from default retrieval and ranking, shown with an explicit range or "include archive";
  - `excluded` — never retrieved, ranked, sent to a model or exposed over MCP;
  - `purged` — content and embeddings deleted, with a tombstone keeping date, kind and source.
- **Retention policies** per record kind and connector, with three settings each:
  - active window (defaults: 180 days for chat, email and transcripts; indefinite for commitments, notes, accomplishments and decisions);
  - archive-after;
  - purge-after (off by default).

  A daily job applies them.
- **Exclusion rules** by date range, connector, channel/project, person or tag. They apply immediately, can optionally trigger a purge, and are reversible until purged.
- **Retrieval order** (used by Ask, MCP `search`, few-shot retrieval and drafting):
  1. time scope from an explicit parameter, else a range inferred from the question (model job `ask.time_scope`, structured output), else the default active window;
  2. SQL filter on `occurred_at` and `retention_state`;
  3. hybrid search (ADR 0003);
  4. recency decay, off when the user gave an explicit range.

  The applied scope is returned with every result set and shown in the UI.

## Alternatives considered

- **Recency boost only, with no hard filter:** rejected. Old items still leak into answers, and costs grow with history.
- **Delete old data on a timer:** rejected as the default. Archive first and purge optionally, because decisions and evidence age differently from chatter.
- **A single global window:** rejected. Different kinds need different lifetimes.

## Consequences

Every connector and importer must supply trustworthy dates. Date parsing for living docs needs tests. The schema carries the retention fields from Phase 1, and the settings UI comes with the semantic layer in Phase 3.
