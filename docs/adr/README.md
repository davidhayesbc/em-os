# EM OS — Architecture Decision Records

These records explain *why* the architecture in [`PRODUCT_SPEC.md`](../PRODUCT_SPEC.md) looks the way it does.

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-backend-service-and-clients.md) | Accepted | A separate backend service owns all logic and data; UIs (VS Code first), the CLI and MCP clients are clients of a versioned API |
| [0002](0002-local-sqlite-store.md) | Accepted, driver by spike | One local SQLite database in OS app-data, owned by the service |
| [0003](0003-hybrid-search-local-embeddings.md) | Accepted | Date-scoped hybrid search: FTS5 + local embeddings, fused by reciprocal rank fusion |
| [0004](0004-time-model-retention.md) | Accepted | Every record is dated; retention (active / archived / purged) and exclusion rules; date filter before semantic search |
| [0005](0005-pluggable-connectors-mcp.md) | Accepted, transport by spike | Capability-based connector plugins with MCP tool-mapping presets; direct MCP client preferred |
| [0006](0006-llm-providers-model-routing.md) | Accepted | Multiple providers (Claude Code CLI, Anthropic API, OpenAI-compatible/LiteLLM, Ollama) and a task-based model router with user overrides |
| [0007](0007-commitment-pipeline-triage.md) | Accepted | Propose → triage → learn; precision over recall |
| [0008](0008-deterministic-ranking-planner.md) | Accepted | Explainable, deterministic ranking and calendar-fit planner; models never reorder |
| [0009](0009-provenance-citations.md) | Accepted | Every derived claim links to stored sources; links never come from model output |
| [0010](0010-ui-clients-widgets.md) | Accepted | VS Code extension as first client: widget dashboard tab + compact sidebar in webviews |
| [0011](0011-one-time-importers.md) | Accepted | Importers are one-time, dry-run-first, date-preserving; personal importers may be ephemeral |
| [0012](0012-privacy-posture.md) | Accepted | Local-first defaults, read-only sources, per-chunk sensitivity, per-model data approval (approved-models list) |
| [0013](0013-emos-mcp-server.md) | Accepted | EM OS exposes its own MCP server, a query layer for Claude Code and other agents, with proposal-only writes |

## Format

Each ADR has: Status, Date, Context, Decision, Alternatives considered, Consequences.

Status values:

- **Proposed**
- **Accepted**
- **Accepted, … by spike** — the boundary is fixed and a Phase 0 spike picks the concrete option; its result is appended to the ADR
- **Superseded by NNNN**

Superseded ADRs are kept and linked to their replacement.
