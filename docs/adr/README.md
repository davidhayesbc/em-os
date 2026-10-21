# EM OS — Architecture Decision Records

These records explain *why* the architecture in [`PRODUCT_SPEC.md`](../PRODUCT_SPEC.md) looks the way it does.

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-backend-service-and-clients.md) | Accepted (spike: bundled Node 24; verified on Windows CI 2026-10-21) | A separate backend service owns all logic and data; UIs (VS Code first), the CLI and MCP clients are clients of a versioned API |
| [0002](0002-local-sqlite-store.md) | Accepted (spike: `node:sqlite`) | One local SQLite database in OS app-data, owned by the service |
| [0003](0003-hybrid-search-local-embeddings.md) | Accepted (spike: `nomic-embed-text`) | Date-scoped hybrid search: FTS5 + local embeddings, fused by reciprocal rank fusion |
| [0004](0004-time-model-retention.md) | Accepted | Every record is dated; retention (active / archived / purged) and exclusion rules; date filter before semantic search |
| [0005](0005-pluggable-connectors-mcp.md) | Accepted, transport by spike (P0-04 pending, owner) | Capability-based connector plugins with MCP tool-mapping presets; direct MCP client preferred |
| [0006](0006-llm-providers-model-routing.md) | Accepted (spikes P0-05/P0-06 pending, owner) | Multiple providers (Claude Code CLI, Anthropic API, OpenAI-compatible/LiteLLM, Ollama) and a task-based model router with user overrides |
| [0007](0007-commitment-pipeline-triage.md) | Accepted | Propose → triage → learn; precision over recall |
| [0008](0008-deterministic-ranking-planner.md) | Accepted | Explainable, deterministic ranking and calendar-fit planner; models never reorder |
| [0009](0009-provenance-citations.md) | Accepted | Every derived claim links to stored sources; links never come from model output |
| [0010](0010-ui-clients-widgets.md) | Accepted | VS Code extension as first client: widget dashboard tab + compact sidebar in webviews |
| [0011](0011-one-time-importers.md) | Accepted | Importers are one-time, dry-run-first, date-preserving; personal importers may be ephemeral |
| [0012](0012-privacy-posture.md) | Accepted | Local-first defaults, read-only sources, per-chunk sensitivity, per-model data approval (approved-models list) |
| [0013](0013-emos-mcp-server.md) | Accepted | EM OS exposes its own MCP server, a query layer for Claude Code and other agents, with proposal-only writes |

## ADR protocol

### When to write one

Write a new ADR, or supersede an existing one, when a change:
- adds or replaces a **runtime dependency, storage engine, transport, protocol or security control**;
- changes a **package boundary, port or public contract**: API ops, MCP tools, the plugin API, schema conventions, data locations;
- **deviates from an accepted ADR**.

A choice made inside an existing ADR's boundary, such as a library for an internal helper or a default value, doesn't need an ADR. Record it in the PR description under "Decisions made within existing ADRs".

### How to add one

1. Copy [`TEMPLATE.md`](TEMPLATE.md) to `NNNN-kebab-title.md`, using the next free number. Numbers are never reused.
2. Fill in every section: Status, Date, Spec, Context, Decision, Alternatives considered, Consequences. Start with Status `Proposed`.
3. Add a row to the index table above. Link the ADR from the spec or plan sections that depend on it.
4. Open it in a PR, alone or with the task that needs it. It becomes `Accepted` when the owner approves the PR. Agents never mark their own ADR Accepted without that approval.

### Changing a decision

- The **Decision** section of an `Accepted` ADR is never rewritten.
- To change course, write a new ADR with `Supersedes: NNNN`, then set the old ADR's Status to `Superseded by MMMM` and update both index rows.
- **Allowed additions** to an accepted ADR:
  - `## Spike result (YYYY-MM-DD)`: the concrete choice a spike made under an "Accepted, … by spike" ADR, with method, evidence and residual risks;
  - `## Verification (YYYY-MM-DD)`: evidence that a claim marked pending now holds. Cite the CI run or the exact command;
  - clarifications that don't change the decision. Note these in the PR.

### Evidence rules

- Say **pending**, **inferred** or **not tested** when that's the truth. Never present an assumption as a result.
- Never record work data, real names, internal hostnames or org-specific values. Describe them generically ("an aggregating MCP gateway").

## Status values

- **Proposed**: under review. Code may not depend on it yet.
- **Accepted**: implement now.
- **Accepted, … by spike**: the boundary is fixed, and a Phase 0 spike picks the concrete option and appends its result.
- **Superseded by NNNN**: kept for history, with a link to its replacement.

Each ADR has these sections: Status, Date, Spec, Context, Decision, Alternatives considered, Consequences.
