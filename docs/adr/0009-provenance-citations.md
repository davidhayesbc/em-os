# ADR 0009: Provenance and citations

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§5.4, 5.8, 9

## Context

Updates, brag docs, promotion packages and answers are only useful if they're trustworthy. Models can invent facts and URLs. The user wants results to link back to their sources.

## Decision

- **Source links:** every derived record (commitment, accomplishment, person note, draft, answer) links many-to-many to `source_item`s.
- **Citation checks:** drafting and answering receive records with stable ids and must cite ids. A validator checks that every cited id exists and was in the input or retrieval set. Uncited substantive paragraphs and invalid citations are highlighted.
- **Links come only from stored `source_item.url`, never from model output.** A source without a URL opens the local record.
- **MCP results:** results returned over EM OS's MCP server carry the same record ids and stored URLs, so agents can cite them.
- **Freshness:** sync age is shown per widget and per answer.
- **Audit trail:** corrections are append-only audit events.

## Alternatives considered

- **Trusting model-written links:** rejected. A fabricated link is the worst trust failure.
- **Semantic entailment checking:** deferred. Citation validity plus human review is enough for a single-user tool.

## Consequences

Prompts and schemas must carry record ids. Clients need a citation affordance: hover to preview, click to open.
