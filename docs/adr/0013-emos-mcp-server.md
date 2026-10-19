# ADR 0013: EM OS as an MCP server

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§3 (G17), 6, 10, 12

## Context

The user works in Claude Code daily and wants it to reach EM OS data: "what do I owe Sam?", "summarise last month's decisions on X". If EM OS can't use Claude Code for processing in some setups, Claude Code can still use EM OS as a query layer. Claude Code may also have MCP access to sources that EM OS can't reach directly (ADR 0005), which makes it a possible ingestion path.

## Decision

The service exposes an **MCP server**:

- streamable HTTP on loopback, authenticated with a **per-client token** (`emos mcp token create <client-name>`). Each token carries its own policy: allowed tools, whether sensitive access is allowed, and a rate limit. Proposals are tagged with that client's name. The token can be revoked.
- `emos mcp`, a stdio launcher that proxies to the running service, for clients configured with stdio servers. Example Claude Code config: `claude mcp add emos -- emos mcp`.

**Read tools** (Phase 1, with search in Phase 3):

- `today` — plan, meetings, top items;
- `list_commitments(direction, status, person, due_before)`;
- `get_person(name|id)` — profile summary, open items both ways, recent notes. This is an explicit person target, so `people_sensitive` sections are included whenever the client's policy allows sensitive access;
- `list_meetings(range)`, `get_meeting(id)`;
- `list_prs(filter)`, `list_tickets(filter)`;
- `search(query, from, to, sources, people, include_archive, include_sensitive)` — date-scoped hybrid retrieval (ADRs 0003–0004).

Each result carries record ids, dates and stored source URLs. The server also exposes MCP **resources**: today's plan and person profiles as Markdown.

**Proposal tools** (Phase 2), which never write trusted records directly:

- `propose_commitment`, `propose_person_note`, `propose_accomplishment`;
- `ingest_items(items[])` — dated source items with URLs from an agent that fetched them (e.g. a Claude Code skill reading the user's MCP servers). They're stored with `origin = mcp_ingest` and go through the normal extraction and triage pipeline.

Proposals land in triage tagged with the client name.

**Policy:**

- exclusions are always enforced;
- `private` content is never returned;
- `people_sensitive` content is returned only when the client's policy allows it **and** either the call explicitly targets that person (`get_person`, a `people` filter, a person id) or `include_sensitive` is true;
- rate limits apply per client token;
- each call is logged as ids and counts only.

**Prompt-injection note:** tool results are data returned to the calling agent. EM OS never executes instructions found in stored content, and has no tools that act on external systems.

## Alternatives considered

- **No MCP server, UI only:** rejected. Claude Code is where the user already works, and it's a useful fallback query layer.
- **Direct DB access for agents:** rejected. It bypasses sensitivity, exclusion and the API contract.
- **Full write tools for agents:** rejected. Every agent write goes through triage so the list stays trustworthy.

## Consequences

EM OS data reaches whichever model the MCP client uses, so the egress depends on the user's client choice. Onboarding makes that explicit, and the per-client sensitivity setting gives control. The MCP tool schemas become a public contract and are versioned with `api-contract`.
