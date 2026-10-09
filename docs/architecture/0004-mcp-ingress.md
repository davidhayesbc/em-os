# ADR 0004: MCP ingress selection

- Status: Proposed, blocked on discovery
- Date: 2026-10-09
- Spec: `docs/PRODUCT_SPEC.md` §§2, 6–7, 9–10, 14

## Context

MCP Locker is expected to expose work systems, but transport, tools, scopes, pagination, credentials, rate limits, and direct-app permission are unknown. Claude Code already connects, but headless invocation and logging/usage terms are unverified. VS Code MCP registration does not imply extension API access.

## Decision

Define one read-only `SourceConnector` port independent of ingress mechanism. For each connector scope it exposes capability/schema version, allowlist, `fetchPage(cursor, window, signal)`, stable source identity/URL, rate-limit metadata, and typed permission/offline/schema-drift errors. It returns bounded validated DTOs and never exposes credentials or executes source text.

Select ingress only after synthetic probes:

A. Prefer a direct maintained MCP SDK if Locker exposes an approved client transport and credential boundary, read-only tool allowlisting works, schemas/pagination are usable, logs are controllable, and target-platform/package gates pass.

B. Otherwise use a bounded Claude Code runner only if policy permits noninteractive invocation and it can use the already-configured Locker with: executable plus argument array (no shell), fixed trusted cwd, sanitized environment, timeout/cancellation/output cap, read-only tool allowlist, JSON-schema output, no raw sensitive logging, and explicit failure mapping.

If neither path passes, fail closed: retain synthetic fixture mode, mark integration unverified, and do not simulate production success. Ingress choice is per approved source if capabilities differ; adapters still satisfy the same port. No fallback may silently route data to a different service.

Schema fingerprints and granted scopes are recorded. Any tool/schema/scope drift pauses ingestion pending review. Retry only retryable transport/rate-limit failures with bounded exponential backoff and jitter; never retry permission, validation, or policy failures automatically. Cursor updates follow ADR 0003.

## Discovery evidence required

Gate `G-MCP-01` records synthetic/non-sensitive results for direct and runner paths: transport and locality, exact tools and read/write scopes, schemas and schema changes, pagination/delta/deletion, rate-limit signals, OAuth renewal and credential owner, prompts/approval UX, output structure, stdout/stderr/log/redaction behavior, offline and retry behavior, package/runtime/license/advisory checks, and macOS arm64 + Windows x64 results. Production scope remains disabled until security gate `G-SEC-01` approves data classes and source allowlists.

## Alternatives considered

- Assume direct extension access: rejected as unsupported by known facts.
- Always mediate through Claude Code: rejected until invocation, policy, logging, and failure semantics pass.
- Build a custom MCP protocol/OAuth client: rejected when a maintained approved SDK can be used.
- Give models broad tools and ask them to behave read-only: rejected; capabilities must enforce scope.
- Implement both production paths immediately: rejected as duplicate attack and maintenance surface.

## Consequences

Connector implementation can proceed against recorded synthetic contracts while real ingress remains visibly gated. Direct MCP may be simpler and deterministic; a runner may reuse approved credentials but adds process/model mediation risks. Users always see permissions, last success, errors, and freshness.

## Test implications

- Recorded synthetic contract tests cover pages, duplicate/update/delete, empty delta, rate limit/retry, permission denial, malformed/schema-drift output, timeout/cancel, output cap, offline mode, and stable URLs.
- Process tests prove no shell expansion, environment minimization, tool allowlist, redacted logs, and termination of child processes.
- A no-network test runs the full fixture path.
- Approved-environment probes are manual/non-CI and must never persist work responses in the repository.
