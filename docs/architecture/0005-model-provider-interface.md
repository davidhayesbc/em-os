# ADR 0005: Model-provider interface and routing

- Status: Accepted interface; routes gated
- Date: 2026-10-09
- Spec: `docs/PRODUCT_SPEC.md` §§2, 6–7, 9–10, 14

## Context

Claude Code, a work LiteLLM gateway, and Ollama may be available, but endpoint dialects, models, auth, policy, quality, and data-class permissions are unknown. Core PR attention must remain deterministic and usable without a model. Tool access must not be conflated with generation.

## Decision

Core depends on a `ModelProvider` port with two operations:

- `generateStructured(request, outputSchema)` returns schema-validated data plus run metadata;
- `generateDraft(request)` returns draft text plus run metadata and cited input IDs.

A request explicitly supplies job/capability (`extract` or `draft`; `embed` is deferred), prompt version, approved input record IDs, data classification, audience, timeout, token/output budget, cancellation, retry policy, and permitted route/model. Responses record provider route alias, model/version when available, start/end, status, token counts when available, prompt version, input IDs, output hash, validation errors, and redacted failure metadata. Raw sensitive prompts/responses are not written to general logs.

A separate policy router matches job + classification to an explicitly configured approved route. There is no brand-name fallback. If no route is approved/healthy, fail closed and return a typed unavailable/policy error. Deterministic ranking, browsing cached records, and manual Markdown drafting still work offline.

Provider adapters minimize outbound fields, delimit untrusted source text as data, disable tools unless a separately approved workflow requires them, demand structured schema output, and validate before use. Instructions embedded in PR/Slack/meeting content are inert. Retries are bounded and do not change provider/model without renewed policy selection. Drafts are never auto-sent or promoted to approved evidence.

Claude Code is a bounded subprocess adapter subject to runner controls in ADR 0004. LiteLLM supports only its verified endpoint dialect (Responses or Chat Completions). Ollama is loopback-only unless explicitly approved and must pass task-quality tests; local does not imply acceptable for sensitive judgment.

## Route gates

`G-MODEL-01` must record per route: endpoint/locality, auth owner/storage, exact model inventory/version behavior, API dialect/JSON/streaming behavior, retention/training/telemetry policy, allowed data classes/jobs, payload minimization, timeout/rate limits, redacted logs, package/license/advisory results, target-platform result, and task-quality evaluation. Embeddings require separate `G-SEARCH-01` benchmark, embedder identity/dimension metadata, and reindex procedure.

## Alternatives considered

- Call provider SDKs from domain code: rejected due to policy/testing lock-in.
- One generic `generate(string)` method: rejected because structured extraction and cited drafting have different validation.
- Automatic cloud/local fallback: rejected because it can violate data policy and reproducibility.
- Require a model for ranking: rejected by deterministic/offline requirements.
- Adopt every AI SDK provider: rejected as unused egress and supply-chain surface.

## Consequences

Routes remain replaceable and auditable, and unavailable models degrade safely. Configuration and run records are more explicit. Exact model identity may be unavailable through some gateways and must be displayed as unknown rather than invented.

## Test implications

- Shared provider contract tests: valid structured result, malformed/extra fields, timeout/cancel, rate limit, output cap, redaction, unknown model identity, and no approved route.
- Prompt-injection fixtures prove source instructions do not become tools/system instructions.
- Router tests cover every job/classification pair and prove no implicit fallback.
- Citation validation runs after generation under ADR 0006.
- Offline end-to-end test still ranks PR attention and creates a manual draft shell.
