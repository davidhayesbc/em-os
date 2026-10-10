# Security and Connector Discovery Record (Spec 0)

Status: conditional / synthetic-only.  Date: 2026-10-09.

This record is deliberately an inventory of verified facts and unverified integration requirements. It does not contain a Locker endpoint, credential, work artifact, private skill, model route, or captured response. The only checked-in probe is `fixtures/security/mcp-discovery-probe.synthetic.json`; it is a fabricated contract-shape fixture, not evidence of Locker behavior.

## Executive decision

Recommendation: NO-GO for a direct MCP Locker client today.  There is no verified direct transport, client registration path, authentication mechanism, tool schema, scope set, pagination/delta contract, rate-limit behavior, or approval for app code to call Locker. Direct connection must remain disabled and unimplemented outside a synthetic adapter.

Recommendation: CONDITIONAL GO for a bounded Claude-mediated discovery spike only after an operator confirms that the existing Claude Code/Locker configuration may be invoked noninteractively for this application and grants a read-only PR scope. The runner must be a separate, opt-in process with a fixed request template and schema-validated JSON output; it is not a general agent, shell, or write channel. Until that approval, the MVP ingress is synthetic fixture import plus deterministic local triage.

The VS Code UI is feasible as a thin local presentation shell, but it is not an MCP credential or tool broker. Do not assume VS Code's MCP registration exposes arbitrary tools to an extension. The CLI/core must own ingestion and work when the extension is closed.

## What was actually inspected

| Area | Result | Confidence |
|---|---|---|
| Product requirements | `docs/PRODUCT_SPEC.md`, sections 2, 7, 9, 10 and 12 were reviewed. | Verified |
| Product repository | Only `docs/PRODUCT_SPEC.md` was tracked at assessment time; no implementation connector or CI workflow existed. | Verified |
| Public-repo safeguards | `.gitignore` and CI secret/PII scanning were absent at assessment time; this change adds local exclusion rules but does not establish CI. | Verified |
| Local tool availability | Node and npm are installed; `claude`, `code`, and `ollama` commands were not found in this assessment environment. | Verified for this environment only |
| MCP Locker configuration | No endpoint/configuration/tool schema was supplied or found in the public repository. No network probe was attempted. | Unverified |
| Existing Claude skills | No user Claude skill directory was present in this assessment environment. No private skill files or note content were read or copied. | Inventory unavailable here |
| LiteLLM/Ollama route | No endpoint, auth method, model inventory, policy, or local Ollama executable was available. | Unverified |

An environment variable name indicating a code-review integration was present, but its value was neither read nor logged. It is not evidence of approval for any EM OS integration.

## Adapter decision matrix

| Ingress / adapter | Transport & auth | Read scope and data minimization | Pagination / delta / retries | Credential boundary | Decision |
|---|---|---|---|---|---|
| Direct MCP Locker PR adapter | Unknown; verify stdio vs HTTP/SSE/streamable HTTP, OAuth/device flow, client registration and TLS requirements. | Start only with an explicit `read:pull-requests`-equivalent scope and repository allowlist. Store ID, URL, repo, state, timestamps and attention-relevant review/CI fields; exclude bodies, comments, diffs, tokens and unrelated identities. | Require bounded page size, opaque cursor/watermark, updated/deleted semantics and `Retry-After` behavior. Cursor changes only in the same transaction as normalized records. Retry only timeout/429/5xx, bounded with jitter; never retry auth, schema, or permission failures. | App must use OS secure storage or an approved Locker-issued credential; never a config file, Markdown, SQLite field, environment dump or log. | NO-GO until all discovery evidence and approval gates pass. |
| Claude-mediated PR discovery runner | Existing Claude-to-Locker route is asserted in spec but not verified here. Confirm headless/noninteractive policy and JSON output contract. | Fixed `list/read PR metadata` request and repo allowlist. The runner returns only the versioned normalized envelope; no freeform transcript. No write-capable tools are exposed. | Runner may request one bounded page/window at a time. Core persists its own cursor only after schema validation and atomic storage. One bounded retry for transient runner failure; no blind prompt retry. | Claude owns its approved Locker login. EM OS receives no Locker secret and must sanitize inherited environment; runner must not print tool traffic or prompts. | CONDITIONAL discovery-only spike after security owner approval. |
| VS Code extension | Extension-host APIs are local UI APIs, not proof of MCP tool access. Verify enterprise policy and extension workspace trust. | The extension consumes local core DTOs over a local process boundary; it does not receive source credentials or raw source payloads. Minimal TreeView/commands preferred. | No durable background sync based on extension timers. It invokes explicit CLI/core sync and displays freshness/errors. | VS Code SecretStorage is only considered after platform policy review; source tokens remain with the approved connector/credential broker. | Feasible as thin UI; not approved as ingestion path. |
| Synthetic fixture adapter | Local file only. | Synthetic values only, no PII/work content. | Deterministic page fixture; test cursor atomicity/schema drift behavior. | No credential. | GO now, required until an ingress is approved. |
| LiteLLM provider | Endpoint/auth/model IDs and approved data classes unknown. | Only an approved `generateStructured` or `generateDraft` capability with field-minimized input; no tool access. | Bound timeout/token budget; retry transient failures only; validate JSON schema. | Credential held by OS/approved secret store; never inherited by arbitrary subprocesses. | NO-GO pending route and policy evidence. |
| Ollama loopback | Binary unavailable here; local model adequacy and corporate policy unknown. | Potentially local-only, but locality is not approval. No personnel, health, promotion, 1:1 or private-channel data by default. | Explicit availability check; no silent cloud fallback. | No implicit model pulls; pin/checksum model artifacts when approved. | NO-GO pending policy and quality evaluation. |

## Required direct-MCP synthetic probe protocol

The fixture defines expected fail-closed behavior, not a production invocation. A future operator-run probe must:

1. Use a disposable client profile and an explicitly approved non-sensitive sandbox repository.
2. Request capability discovery (`tools/list`, and `resources/list` only if approved); record tool names, JSON schemas, scope/error class, pagination shape, rate-limit headers and a schema fingerprint. Do not record response contents, auth headers, endpoint URL, tokens, prompts, or source excerpts in this repository.
3. Invoke at most an explicitly allowlisted read-only PR listing tool with a limit of 50 or less. Assert no mutation tool is offered or invoked.
4. Exercise one initial page, one continuation page, a no-change/delta request, malformed cursor handling, access denial, rate-limit behavior and a simulated transport interruption.
5. Persist a sanitized report outside the public repo or record only pass/fail, schema fingerprint, and approved field names in a public-safe ADR. Any tool/schema/scope drift invalidates approval.

Required output envelope (schema versioned and strict):

```json
{
  "schemaVersion": 1,
  "records": [{"sourceId": "string", "url": "https URL", "repository": "owner/repo", "state": "open|closed|merged", "updatedAt": "RFC3339"}],
  "nextCursor": "opaque optional string",
  "watermark": "RFC3339 optional string"
}
```

Reject additional sensitive fields rather than retaining them. A connector must treat source text as untrusted data, never as an instruction.

## Data classification and egress rules

| Class | Examples | Local storage / retention | Permitted egress now | Later approval requirement |
|---|---|---|---|---|
| S0 public synthetic | Fixtures, fake PR IDs, documentation | Public repo permitted | None required | N/A |
| S1 work operational metadata | PR ID/URL/repo/state/timestamps, curated action metadata | Local encrypted user profile; bounded retention; no Git | No production route approved | Named source scope, storage/backup policy, model route if sent to model |
| S2 internal work content | PR title, limited approved excerpts, Jira summary, calendar title | Local encrypted store with minimization and deletion propagation | No route approved | Source owner approval, purpose/field allowlist, retention and export rules |
| S3 sensitive personnel | 1:1s, performance/promotion evidence, health/morale, private channels/DMs, meeting transcripts | Do not ingest in MVP; if later approved, separately encrypted local storage with auditable access/deletion | Prohibited by default, including to Claude/LiteLLM/Ollama | HR/legal/security approval, consent/need-to-know, encrypted backup/restore drill and explicit model data-processing approval |
| Secrets | OAuth tokens, API keys, session cookies, client secrets | Approved OS credential store/Locker only | Never in prompts, repo, logs, CI artifacts or Markdown | Security-approved secret lifecycle only |

Rules common to all classes:

- Public repository, CI logs, issue bodies, screenshots, test snapshots and telemetry may contain S0 only.
- There is no automatic external telemetry/error reporting carrying S1-S3.
- An outbound request requires an allowlisted destination, declared data-class ceiling, minimal fields, route shown to the user, timeout/token budget and audit metadata without raw payload.
- Missing classification, destination approval, scope, schema version, or credential origin is a hard deny.
- Local cache freshness must be visible; offline values cannot be presented as current.

## Threat model and findings

| Severity | Finding and evidence | Affected area | Required remediation / gate |
|---|---|---|---|
| High | Direct Locker integration would be speculative: transport, tools, scopes, pagination, OAuth renewal and local-app permission are explicitly unverified in the spec. A permissive client could overread or mutate work systems. | Future connector | Keep direct mode disabled. Approve only a schema- and scope-pinned, read-only adapter after the synthetic probe protocol and owner approval. |
| High | Sensitive work/personal data could escape through model prompts, tool transcripts, debug logs or coding-agent context. The spec itself requires no raw prompt logging. | Future model runner, logs, CI | Enforce classification ceiling, payload allowlists/redaction, metadata-only audit logs, no `shell`/tool passthrough, and CI checks before S1+ enablement. |
| High | At assessment start the public repo had neither `.gitignore` nor CI scanning despite a requirement to exclude DBs, workspaces, notes, transcripts, exports, credentials, logs and caches. | Repository hygiene | Added `.gitignore`; add secret/PII scanning and a synthetic-fixture-only CI policy before implementation. Treat this as an unresolved release gate until CI exists. |
| High | A generalized Claude runner can become a confused deputy if it has broad Locker tools or allows source text to steer its prompt/tool selection. | Claude-mediated ingestion | Fixed executable/arguments/cwd, sanitized environment, explicit read-only tool allowlist, static request schema, JSON-only output, timeout/output cap and no shell. Test adversarial source text as inert data. |
| Medium | Cursor advancement after a partial page or error can silently lose records; retries can duplicate them. | All connectors | Normalize idempotently by provider+source ID; atomic records/cursor commit; retain a safe replay window; no cursor advance on any failure. |
| Medium | VS Code extension may be mistaken for an MCP client/secret store and its timers may be treated as durable jobs. | Extension/UI | Extension is presentation-only. Core CLI owns connector session/cursor; manual sync is baseline; no autonomous scheduler claim. |
| Medium | Existing Claude skills may contain private prompts, paths, configuration or notes; copying them into the public repo would violate the product boundary. | Skill adapter work | Inventory names/declared interfaces only with owner approval. Do not copy content. Use scrubbed synthetic input/output contracts. |
| Medium | Local encrypted-at-rest and backup claims are unverified across work Mac and Windows. Plain SQLite/unencrypted backups could expose S1-S3. | Storage/backup | Obtain corporate storage policy; require FileVault/BitLocker evidence, approved application-data path, encrypted backup and restore drill before S1+ data. |
| Medium | Dependency/client selection may create native-binding or supply-chain exposure. No dependency manifest exists yet. | Future Node/VS Code project | Pin lockfile, SBOM, license/advisory review, minimal maintained SDK, integrity-aware install, Mac arm64/Windows x64 test, and no unreviewed postinstall scripts. |
| Low | Synthetic fixture can be mistaken for a real Locker schema if not clearly labelled. | Fixtures/docs | Fixture has `UNVERIFIED` markers and is validated by a policy script; production code must not import its tool name as an assumed contract. |

## Existing Claude skill inventory

No skill was found in the local assessment profile or home configuration paths. This is not evidence that no corporate skills exist; it only means this environment cannot safely inventory them. No private notes, prompt bodies, skill content, or user configuration were opened.

For a future approved inventory, record only: skill identifier, owner-approved location class (not path if sensitive), invocation policy, declared input classification, output type/schema, tool permissions, model route and whether an output can be represented as proposed actions/decisions/evidence. Use synthetic samples only. Do not import a skill's source, its user notes, previous transcripts, or embedded credentials into `em-os`.

## Security approval gates for downstream cards

1. Connector implementation (Spec 3): a security owner approves direct vs Claude-mediated route after the synthetic discovery report; read-only scope, repository allowlist, strict DTO, pagination/deletion semantics, retry budget and credential owner are documented. Otherwise synthetic adapter only.
2. Core/storage (Spec 1/2): approved per-OS application-data locations; no sensitive data in checkout; OS encryption and encrypted backup/restore test; secret store abstraction; retention/deletion propagation design.
3. VS Code (Spec 1/4): workspace-trust behavior and enterprise extension policy confirmed; extension holds no source token and invokes local core only.
4. Drafting/model adapter (Spec 5): approved provider/model IDs and data-class matrix; no implicit fallback; prompt/output schema validation; adversarial prompt-injection test; payload/log redaction verification; human approval required before save/export/send.
5. Source adapters (Spec 6): separate source-specific scope/field/retention review. Private channels, DMs, indiscriminate meetings and S3 data remain disabled unless separately approved.
6. Evidence/review packet (Spec 7): HR/legal/security authorization for personnel data, local access/retention/export controls, consent/need-to-know model and deletion/audit policy.
7. Public-repo/CI release: secret and representative-PII scan, fixture allowlist check, artifact/log review, dependency audit/SBOM and no real endpoint/configuration test.

## Go/no-go conditions

GO (synthetic MVP): deterministic local ingestion of checked-in synthetic fixtures; no network, credentials, model route, private skills or work content.

CONDITIONAL GO (bounded Claude discovery): only after the security owner documents policy approval and the runner meets the hardening contract above using a non-sensitive sandbox source.

NO-GO (direct MCP and real data): until all unknowns in the direct adapter row are evidenced and gates 1, 2 and 7 are passed. S3 is NO-GO for MVP regardless of connector readiness.

## Local verification

Run from repository root:

```text
node scripts/validate-security-discovery.mjs
```

The script checks that the committed fixture is synthetic, explicitly unverified, read-only, bounded, field-minimized, transactional for cursor advancement, and fail-closed for authorization/schema failures. It does not contact any external service.
