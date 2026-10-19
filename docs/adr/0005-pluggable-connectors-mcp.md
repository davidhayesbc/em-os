# ADR 0005: Pluggable connectors over MCP

- **Status:** Accepted; transport chosen per server by Phase 0 spike
- **Date:** 2026-10-19
- **Spec:** §§2, 7.2, 7.8–7.9, 11

## Context

EM OS must work for anyone, so no chat, calendar, email, docs, ticketing, code-host or observability vendor can be hardcoded. Many users already reach these systems through MCP servers: official vendor servers, community servers, or an organisation's MCP gateway that aggregates many services behind one OAuth login. Some MCP servers only authenticate inside a particular client, such as Claude Code.

## Decision

A **connector** is a plugin implementing `ConnectorDefinition` (spec §11). Its kind is one of `chat`, `calendar`, `email`, `meeting_notes`, `code_host`, `tickets`, `docs` or `observability`. It has a config schema, a read-tool allowlist, `sync(scope, cursor)` returning *dated* items, optional live tools for Ask, and optional completion signals.

Connectors are written against **capabilities**, not tool names. For example:

- `chat`: `searchMessages`, `readThread`, `listMentions`, `listDMs`;
- `tickets`: `searchTickets`, `getTicket`, `listTransitions`;
- `docs`: `searchSharedWithMe`, `getDocument`, `getRevisionInfo`.

A **tool-mapping preset** binds the capabilities to one MCP server's tool names and argument shapes. For example, a chat preset might target "an aggregating gateway's Slack tools" or "the official Slack MCP server", and a tickets preset "the Atlassian MCP server". Presets ship in the repo, and users can override any binding or write their own.

There are three transports:

1. **`mcp_direct`** (preferred): the service is an MCP client (`@modelcontextprotocol/sdk`) over stdio or streamable HTTP. Server definitions come from EM OS's own list or are imported from the user's Claude Code / VS Code MCP config. Credentials or OAuth tokens are held in the OS keychain by the service. This path is deterministic, cheap and fast.
2. **`mcp_via_agent`** (fallback): for servers whose authentication only works inside Claude Code. A headless `claude -p` call (ADR 0006 `claude-code-cli`) is restricted by `--allowedTools` to the mapped read-only tools.

- **Parsing:** the service reads the **verbatim tool-result blocks** from the stream-JSON output, never the model's prose. So URLs and ids come from the source system, not the model.
- **Egress:** source content passes through Claude, so this transport is allowed only when the Claude model used is approved (ADR 0006) for the connector's provisional sensitivity for that item kind.
- **Cost:** it's slower and uses model calls.
3. **`native`:** a REST/SDK/CLI client (e.g. a Jira REST API token, `gh`) when no suitable MCP server exists.

The inverted alternative to `mcp_via_agent` is also supported: a Claude Code skill pulls from the user's MCP servers and pushes items into EM OS through its MCP `ingest_items` tool (ADR 0013).

**Phase 0 spike:** for each of the initial user's MCP servers, can `mcp_direct` authenticate, list tools and do a paginated read? Record the answers here.

If not, fall back per server in this order:

1. `native`, if an API token path exists;
2. `ingest_items` pushed by a Claude Code skill;
3. `mcp_via_agent`.

**Provisional sensitivity:** each connector declares a default sensitivity per item kind (e.g. DMs, 1:1 transcripts and email → `people_sensitive`; channel messages, PRs and tickets → `normal`). Items carry it until classification refines it.

**Rules for all connectors:**

- read-only tools only, and unlisted tool calls are refused;
- validated, dated DTOs out;
- the service persists, and the cursor advances in the same transaction;
- bounded retry with backoff on transient errors, and no retry on authentication or permission errors;
- per-connector health is shown in the UI;
- a schema-drift check (tool-list hash) warns when a server changes.

## Alternatives considered

- **Hardcoding one MCP server's tool names:** rejected. It isn't portable.
- **Agent-mediated fetching for everything:** rejected as the default. It's nondeterministic, slow and costly.
- **Native API clients only:** rejected. They duplicate authentication work that MCP servers already solve.

## Consequences

Adding a source is often just a new preset. Presets need contract tests against recorded synthetic fixtures for each server.
