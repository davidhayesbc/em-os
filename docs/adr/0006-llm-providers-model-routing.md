# ADR 0006: LLM providers and task-based model routing

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §8

## Context

The user's primary LLM is Claude through Claude Code (a claude.ai subscription). They also have a LiteLLM gateway that fronts other models, and Ollama locally. Jobs differ a lot:

- high-volume cheap classification (is this a commitment? does this look done?);
- quality drafting;
- reasoning Q&A with tools;
- embeddings.

The user wants appropriate models selected automatically per task, with control whenever there's a choice. Other users will have different providers.

## Decision

**Providers** implement the `LlmProvider` port: `extract<T>(job, input, schema)`, `draft(job, records, instructions)`, and `ask(question, chunks, liveTools?)` as a stream.

| Provider | How it works |
|---|---|
| `claude-code-cli` | Runs the user's installed `claude` binary headless (`claude -p`, JSON / stream-JSON) as a bounded subprocess: argument array with no shell, fixed working directory, timeout and cancel, and an explicit `--allowedTools` list (none for extract/draft; read-only live tools for ask). It uses that install's existing login and MCP config. EM OS never handles Claude credentials. |
| `anthropic-api` | Anthropic API key, or Bedrock / Vertex. |
| `openai-compatible` | Any OpenAI-compatible endpoint, e.g. a LiteLLM gateway. Its model list comes from the endpoint. |
| `ollama` | Local models; embeddings and optional small jobs. |

**Model registry.** Entries are discovered from providers (gateway `/models` and model-info endpoints where available, Ollama tags, known models for the API providers). They're merged with a built-in **capability catalog** for well-known model families and with user edits. Each entry records:

- capabilities (`extract`, `classify`, `draft`, `reason`, `tool_use`, `long_context`, `embed`);
- quality, cost and latency tiers;
- context window;
- locality;
- its **data approval** (`normal` / `people_sensitive` / `private`), set **per model**:
  1. an explicit Settings value takes precedence;
  2. then an entry in the user's `approved-models.yaml`, which mirrors an organisation's PII-approved model list and records `basis`, `approved_on` and optional `review_by`;
  3. then the provider default: remote → `normal`, local loopback → `private`.

  Exact model ids are the norm. Glob patterns need `pattern: true` and are shown with their current matches, so a model newly added to a gateway never silently inherits sensitive approval. An overdue `review_by` shows a reminder but doesn't revoke the approval.

Unknown models get no capabilities until the user tags them. They are never guessed into use.

**Jobs** declare requirements and a preference (spec §8 table).

**Router:**

1. Filter by capability, by the job input's maximum sensitivity against each model's data approval, and by provider health. The approval level and basis that allowed a run are recorded in `model_run`.
2. Pick deterministically by preference: cost, latency or quality.
3. Apply user pins and fallback order.

The Settings → Models view shows each job, its chosen model, why it was chosen, and the alternatives. A fallback happens only to a model that passes the same filter, and is recorded in `model_run`. If nothing qualifies, the job fails visibly with the reason.

**Structured output** is validated with Zod for every provider, with one retry on invalid output. Prompts are versioned files. `model_run` records job, provider, model, prompt version, input ids, usage and latency, without raw prompt text.

**Usage guard:** a daily budget per provider, in tokens or calls. Subscription-backed `claude-code-cli` shares rate limits with the user's interactive use, so background jobs pause first. Extraction is batched per thread or meeting.

**Terms note:** Anthropic's guidance says third-party products shouldn't offer claude.ai subscription login without approval. EM OS therefore implements no Claude login flow. `claude-code-cli` delegates to the user's own Claude Code install. Phase 0 re-checks the current terms. If this use is not acceptable, the user routes Claude jobs via `anthropic-api` or the LiteLLM gateway instead.

**Evaluation (Phase 5):** a small synthetic eval set per job lets the user compare candidate models, and feeds back into catalog tiers.

## Alternatives considered

- **One fixed model:** rejected. It's wasteful for classification and weak for drafting, and ignores the gateway.
- **Letting an LLM pick the model:** rejected. It's non-deterministic and unexplainable.
- **A generic multi-provider SDK as the core abstraction:** not needed. The port is small, so adapters can use whatever SDK suits them.

## Consequences

Auto-selection is only as good as the capability metadata, which is why the catalog, user tagging and evals exist. Per-model data approvals make "where does my data go" explicit and auditable, and can mirror an organisation's PII-approved model list. The CLI adapter's JSON format is an external contract that `emos doctor` checks.
