# ADR 0012: Privacy posture

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§4, 8, 10

## Context

EM OS holds sensitive material: 1:1 notes, profile notes, others' brag docs, promotion evidence. It must be usable daily on real data, without approval ceremonies that stop it ever being used. Data flows to several places (model providers, an embedder, MCP servers), and with the MCP server (ADR 0013) out to agents. The code lives in a public repository.

## Decision

Safety comes from product defaults:

- **Local data:**
  - the service's app-data directory only, with a startup refusal inside a git checkout;
  - OS disk encryption assumed;
  - `emos backup` writes to a user-chosen path.
- **Egress:** only to router-selected providers, the configured embedder (loopback by default) and the user's MCP servers. No telemetry. Logs hold ids and counts, never content.
- **Read-only externally:**
  - connector tool allowlists are enforced in code;
  - no model gets external write tools;
  - drafts go to the editor or clipboard;
  - EM OS's own MCP server writes only proposals into triage.
- **Per-chunk sensitivity:**
  - `normal`;
  - `people_sensitive` — profile notes, others' brag docs, 1:1 career/wellbeing/feedback, promotion material. It's never auto-accepted, excluded from team-audience drafts, and returned by Ask or MCP only when the query targets that person or explicitly includes sensitive items;
  - `private` — sent only to models explicitly approved for `private` (by default only local models), and never over MCP, because the MCP client's model is unknown to EM OS. It's embedded only by an embedder approved for `private`; otherwise it's keyword-search only.

  Importers map known headings. Connector items start with a **provisional** level per item kind (ADR 0005). A classifier job refines labels, but only on a model approved for the provisional level. The user can relabel anything.
- **Explicit person targeting:** "about that person" means a person id or filter, a `get_person` call, the profile view, or a visible roster-name chip in Ask. It is never inferred by a model.
- **Per-model data approval** (ADR 0006):
  - models are approved for `people_sensitive` or `private` explicitly, typically from an approved-models list that mirrors the organisation's PII list;
  - unlisted remote models get `normal`;
  - the router enforces approvals, and the store's retrieval layer enforces filters, so the UI isn't the only line of defence.
- **Exclusions** (ADR 0004) apply everywhere: retrieval, ranking, models and MCP.
- **Prompt injection:** source text is delimited as data, outputs are schema-validated, and there are no external write tools.
- **Secrets:** kept in the OS keychain by the service. Never in config, never sent to clients.
- **People-facing rules:**
  - no per-person scores or rankings;
  - pronouns come from the person record;
  - unknown pronouns are shown as unknown and rendered they/them in generated prose, never inferred from a name.
- **Public repo:**
  - code, docs and synthetic fixtures only;
  - CI runs a secret scanner and a fixture check;
  - real names, workspaces and org-specific values never appear in fixtures.
- **Remote hosting** stays unsupported until TLS, authentication and this ADR are revisited.

## Alternatives considered

- **Approval gates before real data:** rejected. Gates delay real use indefinitely.
- **No sensitivity model:** rejected. 1:1 and promotion material needs different handling from chat chatter.
- **Application-level DB encryption now:** deferred. It's a native packaging risk, and disk encryption covers the single-user laptop threat model. Revisit for remote hosting or unmanaged machines.

## Consequences

Onboarding states that the user is responsible for confirming their employer permits the chosen providers and MCP servers. Sensitivity filtering lives in the store and router layers, and is tested there.
