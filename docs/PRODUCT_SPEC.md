# EM OS — Product and Engineering Specification

- **Status:** Draft for review and agent-team decomposition
- **Repository:** https://github.com/davidhayesbc/em-os
- **Canonical implementation checkout:** `/workspace/em-os` (Hermes workers); work Mac/Windows paths configured per installation
- **Audience:** Product owner, engineering agents, security reviewer, QA
- **Scope:** Local-first, single-user engineering-manager workbench; six to seven direct reports initially

## 1. Product thesis

EM OS is a private, evidence-linked workbench that helps a hands-on engineering manager notice blockers, keep commitments, prepare meetings, draft updates, and maintain *human-curated* evidence for reviews and promotion. It should connect the manager's existing VS Code + Foam Markdown practice to work systems through MCP Locker, without turning employees into scores or requiring a new all-in-one developer workstation.

**North-star question:** “Given my priorities and commitments, what should I act on next, and what source evidence supports that recommendation?”

The existing [`em-template`](https://github.com/davidhayesbc/em-template) is a Markdown/Foam leadership knowledge base with Daily-Logs, Weekly-Summaries, People, Systems, Decisions, Risks, Processes, Team-Health, 1-1s, Strategy and Roadmaps. Preserve its human-editable workflow. Existing Claude skills for meeting-note catch-up and daily previews are assets to evaluate and wrap, **not** functionality to rewrite blindly.

### Success criteria

1. A morning view finds due follow-ups, today's relevant meetings, team blockers and PR attention items, with source links and an explanation of rank.
2. A weekly update draft assembles verified events, outcomes, risks and next steps with citations, editable in Markdown; no unsupported claims.
3. A meeting-notes import proposes actions, decisions and potential evidence; the manager confirms before they enter the trusted record.
4. A review packet draft organizes *approved* evidence against a supplied competency rubric with gaps and counter-evidence; never infers rating or promotion readiness solely from activity metrics.
5. All work content, caches, prompts, DB, logs and exports stay on the local device except approved requests to MCP Locker / approved work LLMs. No work content in the public code repo or external telemetry.
6. A supported Mac and a Windows installation can each run independently; no automatic cross-machine replication is required for MVP.

## 2. Known facts, assumptions and discovery gates

**Known:** MCP Locker exposes most needed systems (assume Slack, Jira, Datadog, Calendar and source-control PRs). Claude Code already connects to MCP Locker. Claude Code is the primary interactive agent; LiteLLM-accessible work models and Ollama are possible additional providers. The work Mac is an M5 MacBook Pro with 48 GB RAM; Windows laptop support matters. Work-approved LLMs may process sensitive data, subject to task/data-class policy. The existing Foam repo is locally git-versioned on the Mac. `em-os` is a separate public GitHub repo containing this specification; no private work content belongs in it.

**Not yet verified; do not hard-code:** MCP Locker transport, actual tool names, pagination, permissions, rate limits, OAuth renewal, meeting-notes access, whether local app code may call MCP Locker directly, LiteLLM endpoint/auth/model IDs, Claude Code headless invocation and usage terms, Ollama model adequacy, VS Code extension API access to MCP tools, data retention requirements, corporate security policy, and who may see personnel records.

**Discovery gate (before connector implementation):** with synthetic/non-sensitive probes, record MCP tool schema and permitted operations for each source, credentials boundary, pagination and delta-sync behavior, local-vs-remote transport, offline behavior and safe retry policy. Choose **direct MCP client only if MCP Locker supports it**; otherwise prototype a narrow Claude Code-mediated ingestion runner. Do not assume VS Code's own MCP registration automatically exposes arbitrary tools to an extension. Spike and document the integration choice before product code depends on it.

**Discovery gate (before sensitive data ingestion):** security review of allowed data classes, model destinations, on-disk protection, local backup, retrieval scope and HR record policy. Until approved, use synthetic fixtures only.

## 3. Users and jobs to be done

- **Manager (sole user initially):** morning triage, unblock engineers, prepare 1:1s, work on code, review PRs, write updates, track decisions and risks, gather fair evidence for review cycles.
- **No employee-facing portal or manager surveillance product.** Team members are subjects in records, not users or objects to rank against each other.
- **Hands-on development:** links into PRs/issues and the active code workspace, coding-agent terminal interoperability, context switching between EM and coding tasks. No requirement to build a full IDE, git-worktree orchestrator or PR review engine; VS Code/Claude/Codex already cover that.

## 4. Product boundaries and release slices

### MVP (vertical slice)

1. Local workspace selection and settings; local SQLite store; synthetic-data demo.
2. One PR provider through MCP Locker (subject to discovery): incremental fetch, status changes, attention rules, source links, explicit sync indicator.
3. Action inbox with manual create/edit/confirm/complete/snooze and provenance.
4. Morning briefing/“what next” with deterministic ranked candidates and human-readable reasons; no LLM dependency for core ranking.
5. Weekly update draft from curated structured facts, citing each substantial claim; open editable Markdown in the existing Foam workspace, never auto-send.
6. VS Code command palette plus small sidebar/tree or webview for attention queue and details. CLI/headless sync sharing the same core for closed-IDE operation if feasible; at minimum explicit manual sync works offline and in both target OSes.

### Following releases

- Meeting notes via existing Claude skill / MCP or local import; Slack/Jira/Calendar connectors with review queue and cross-source dedup.
- Datadog incidents and initiative context; optional approved performance-evidence capture and rubric-based packet drafting.
- Optional local search over permitted text, notifications and scheduling, cross-device portability and additional provider routes.

**Non-goals for MVP:** autonomous writes to Slack/Jira, continuous employee monitoring, numerical employee scores, per-person merge-speed league tables, sentiment inference, a full desktop shell, multi-user server, cloud database, automatic git sync of private data, fully automated promotion decisions, autonomous code changes from EM OS.

## 5. Experience design

### Primary surfaces

- **VS Code extension (preferred UI shell, contingent on spike):** command palette `EM OS: Sync`, `Open Inbox`, `What Next`, `Draft Weekly Update`, `Capture Evidence`; sidebar lists source-backed items. Open Foam Markdown in ordinary editor. Keep webview minimal; accessibility and keyboard navigation required.
- **Core/CLI:** separate testable local library/command runner for ingestion, queries and drafts. Extension is a thin presentation layer; jobs must not depend on an open webview. If extension integration is blocked by work policy or MCP access, CLI + Markdown remains a usable MVP and UI can follow.
- **Existing skills:** import/adapter interface for Claude meeting catch-up and daily-summary skills; compare their current output contracts with proposed event/action schemas and preserve familiar prompts where practical.

### Representative flows

**Morning:** explicit/scheduled sync → freshness and errors shown → rules compute candidates → manager opens top item → sees rationale, due date and source → completes/snoozes/marks not actionable. If data is stale, say so instead of presenting it as current.

**PR attention:** detect “review requested of me,” “CI failed for threshold,” “no relevant activity for threshold,” and “issue/initiative blocked.” Thresholds configurable by repo; drafts and known long-running PRs suppressible. A slow merge is a *workflow signal*, not an individual performance verdict. Clicking opens the actual PR; no Slack nudge without explicit approval.

**Meeting import:** select approved note or run existing skill → extract proposed actions/decisions/evidence with quote or document anchor → reviewer accepts/edits/rejects → dedup proposal links to existing item or creates new. No raw transcript retained by default.

**Weekly draft:** select week + audience → list included evidence first → generate from approved local facts using an allowed provider → validate citations against retrieved IDs → save to `Weekly-Summaries/` or configured path as a draft → manager edits and sends manually.

**Performance evidence:** manually create or approve proposed observation; tag competency, impact, context, date, source and consent/sensitivity class. Review packet requires a local target-level rubric; missing rubric means request one, not invent it. Distinguish observed actions, impact, manager interpretation and unknowns. Reviewer controls export; no automatic person-note injection until reviewed.

## 6. Architecture and data contracts

```
MCP Locker / approved local files
       │ read-only scoped adapters (schema version, cursor, rate limits)
       ▼
local sync runner ──> immutable provenance records ──> review queue
       │                          │                         │
       ▼                          ▼                         ▼
SQLite metadata / FTS       rules + local queries    approved action/evidence
       │                          │                         │
       └─────────────> core service / CLI <─────────────────┘
                            │
               VS Code UI / Foam Markdown drafts
                            │
             approved LLM gateway (Claude Code / LiteLLM / Ollama)
```

**Storage:** SQLite is the initial index and structured store; use built-in FTS5 for local lexical search. No vector extension in MVP. Add embeddings only if an evaluated task needs them, with model/version metadata and re-index procedure. SQLite native module packaging is a cross-platform risk: spike a maintained Node binding vs WASM-backed alternative and exercise macOS arm64 + Windows x64 before choosing. Keep DB outside the Git checkout in an OS-appropriate per-user application-data directory; workspace configuration contains no secrets or actual people data. OS encryption/FileVault/BitLocker and encrypted backup policy are required; evaluate application-level DB encryption against threat model rather than assuming plain SQLite meets every corporate requirement.

**Store/Markdown relationship:** curated structured records in SQLite power queries; Foam notes and generated drafts are human-authored artifacts. Do not silently treat arbitrary note text as verified facts or overwrite hand-written sections. Imported `em-template` files remain intact; generated sections, if later added, use explicit markers and atomic write + conflict preview. Do not automatically commit private note files to `em-os`.

**Core entities (minimum contract, not final DDL):**

- `people`: local ID, display name, role, source-specific identities with confidence and manager confirmation; never merge by name alone.
- `source_records`: provider, source ID + stable URL, occurred/observed timestamps, permitted excerpt or digest, content hash, classification, last-seen time, deletion/retention state. Unique `(provider, source_id)` for idempotency.
- `sync_cursors`: connector + scope, cursor/watermark, last success/error, fetched count; transactional update only after successful persistence.
- `prs`: provider/repo/ID, author, reviewers, created/updated/merged timestamps, draft/CI/review status, last relevant activity, current state, raw reference to source record. Avoid persisting unnecessary code/comment bodies.
- `action_items`: local ID, owner (including manager/unknown), description, due date with timezone, status, explicit source relationships (many-to-many), review status, audit trail, snooze and suppression.
- `evidence`: subject ID, observation, impact, competency tags, source links, author/approver, observed date, interpretation field, sensitivity, status (`proposed/approved/rejected/superseded`); immutable correction/audit history.
- `initiatives`: goals, deadlines, dependencies, mapped issues/PRs; explicitly curated so prioritization isn't a popularity contest.
- `drafts`: type, period, audience, input record IDs, model route/version, generated file path, generation time and reviewer state.

Do not store whole Slack histories, transcripts, raw PR comments, secrets or HR records by default. Ingestion uses bounded windows, allowlisted channels/projects/repositories, strict field minimization and configurable local retention/deletion. Foreign keys, migrations, indexes and export/import versioning required. All timestamps stored UTC with timezone-aware presentation.

**Idempotency/dedup:** exact provider+source ID first; action proposals may suggest similarity matches using title/owner/time/source, but **human decides** merge vs separate when ambiguous. Preserve all evidence source links after merge. Re-sync never reopens completed items without a new explicit event.

**Evidence/citations:** every generated claim must map to an approved record ID + source URL/document anchor where permitted. If inaccessible, show local provenance and mark `source unavailable`; never fabricate a link. A validator checks referenced IDs exist and were in the generation input set; citation validity does not guarantee semantic truth, so human review stays mandatory.

## 7. LLM/model routing

Define a provider interface (`generateStructured`, `generateDraft`) separate from tool access. Work-approved Claude Code path is initially the likely route for MCP-backed workflows, **but** verify that invocation is permitted, noninteractive when needed, and returns parseable structured outputs without leaking MCP responses into uncontrolled logs. LiteLLM is an optional OpenAI-compatible gateway only after endpoint, auth, model inventory, routing and data-policy discovery. Ollama is optional local processing, never an assumption that local output is accurate enough for sensitive judgments. Codex CLI may help hands-on coding but is not required for EM OS ingestion.

Configuration per job: permitted provider/model, data-class ceiling, timeout, token budget, retry/backoff and human approval policy. Fail closed when no approved route exists. A local deterministic path must still support PR attention and basic triage when models are unavailable. PII minimization before prompts, untrusted source-text boundaries, structured JSON-schema output validation, prompt versioning and an auditable run record **without raw sensitive prompt logging**. Never execute instructions embedded in Slack/meeting/PR content; they are data, not commands. No autonomous model-initiated write to corporate systems in MVP.

## 8. Prioritization policy

Rank *work items* using configurable factors: explicit manager-set strategic priority, blocker severity/critical path, due date/commitment, time waiting for manager action, meeting imminence, freshness/confidence and user dismissals. Stable rule IDs and score components shown in UI; deterministic tie-breaker. Configurable caps prevent noisy sources overwhelming the list. Do not infer urgency from message volume or PR counts alone. LLM may explain/wordsmith but cannot silently change the ordering; manager can pin, dismiss, snooze or correct a candidate with a reason. Display “insufficient context” where initiative data is missing.

Example: a report is blocked on the manager's review for a committed milestone → top candidate with PR link and milestone linkage; a stale draft PR with no deadline → lower and suppressible. Store feedback for tuning rules, not personnel scoring.

## 9. Privacy, security, and operating constraints

- **Public repository safety:** `em-os` holds code, schemas, docs and synthetic fixtures only. `.gitignore` excludes local DB, workspaces, notes, prompts, transcripts, exports, credentials, logs and caches; CI scans for secrets and representative PII. Existing `em-template` local work content is not copied into public GitHub. Do not assume a repository's visibility changes the employer's data-handling rules.
- **Local first is not no egress:** MCP Locker and approved work LLM calls send selected content to approved services. UI displays route/classification; outbound payloads minimized. No analytics or error reporting with work content by default.
- **Access:** read-only scopes by default; separate credentials for sources, no tokens in config/Markdown/logs; use OS credential storage or approved locker. Avoid exposing personnel data to coding agents working in public repos; explicit workspace trust and profile boundaries.
- **Sensitive domains:** 1:1s, performance, promotion and health/morale notes have stricter consent, retention and export handling. Do not ingest private channels, DMs or meetings indiscriminately. No auto-derived “mentorship” from review count and no per-person productivity comparison.
- **Resilience:** offline read/draft from local cache with freshness banners; connector errors isolated; bounded retries; no partial cursor advancement. Local backups encrypted and restorable in a drill. Deletion propagates to source excerpts, FTS and generated-cache indexes where policy requires, with an audit tombstone if allowed.
- **Schedules:** background sync runs only when allowed and the host is awake. First release may be manual and extension-open; a portable CLI plus OS scheduler integration is a subsequent, separately tested option. No claim of always-on sync from VS Code timers.
- **Cross-device:** independent local instances initially. Do not git-sync SQLite or sensitive Markdown to the public repo; future encrypted, employer-approved sync must define key management and conflict resolution.

## 10. Quality requirements and verification

- **Correctness:** idempotent sync; pagination and updated/deleted record handling; deterministic rules; time-zone/DST fixtures; source/identity ambiguity prompts; never invent citation or promote proposed evidence to approved automatically.
- **Usability:** actionable morning view after one command; keyboard navigation; accessible labels and contrast; clear freshness, sync failures, source permission errors and snoozed state.
- **Performance:** bounded ingestion windows and storage growth for six to seven reports; evaluate on realistic synthetic multi-month fixtures. No numerical latency SLO until baseline measured.
- **Portability:** CI matrix macOS arm64 and Windows x64 for install/build/unit tests; manual smoke of VS Code extension, SQLite binding and approved model/MCP route on both OSes when access exists.
- **Security:** threat-model review of prompt injection, data egress, log leakage, public-repo accident, source overreach and credential storage. Test an adversarial Slack note that says to ignore policy; it must remain inert source text.
- **Test layers:** pure unit tests for rules, schema, dedup and citations; contract tests with recorded **synthetic** MCP fixtures; migration/backup/restore tests; extension UI smoke; end-to-end synthetic demo for PR attention → action confirmation → briefing → weekly draft. Real work-data tests run only in approved environment and must never upload fixtures to CI.

## 11. Agent-team execution plan

Each implementation card must name canonical repo `/workspace/em-os`, this source spec `docs/PRODUCT_SPEC.md`, bounded acceptance criteria, tests, and whether a PR is expected. Workers must verify `git -C /workspace/em-os remote -v` before git branch/commit/push/PR operations. `/repo` belongs to Hermes orchestration, **not this product**. The public `em-os` repo has `main` as its default branch and the spec is published; implementation PRs still require per-task auth, permissions and CI checks. Product owner's review gates apply before sensitive integrations.

### Agent backlog checklist

These checkboxes are the automation source of truth for Hermes next-work
planning. A task sourced from this list must update its checkbox when its
acceptance evidence is complete; partial work must leave the item unchecked
and record the remaining scope.

- [x] Spec 0 — Complete product/security discovery and record the MCP Locker adapter matrix, approved data boundaries, existing Claude skill inventory, VS Code feasibility, and approved model routes. See `docs/SECURITY_CONNECTOR_DISCOVERY.md`; direct MCP and real-data routes remain fail-closed pending the listed approvals.
- [x] Spec 1 — Build the cross-platform core, CLI/extension scaffold, local settings, and synthetic PR-attention demo.
- [ ] Spec 2 — Implement storage, provenance, migrations, idempotency, audit states, retention, and backup/restore tests.
- [ ] Spec 3 — Complete the read-only PR connector spike with permitted MCP Locker access and synthetic paginated contract fixtures.
- [ ] Spec 4 — Build the deterministic attention engine and accessible UI with suppression and freshness handling.
- [ ] Spec 5 — Implement the approved drafting/model adapter with citation validation, offline fallback, and prompt-injection tests.
- [ ] Spec 6 — Add separately scoped meeting, Slack, Calendar, and Jira adapters that feed a human review queue.
- [ ] Spec 7 — Build the approved-evidence and rubric-based review-packet workflow with deletion, export, and human sign-off controls.

| Order | Suggested card / owner | Acceptance evidence | Dependencies |
|---|---|---|---|
| 0 | Product/security discovery (`product-owner`, `security`) | MCP Locker adapter matrix; existing Claude skill inventory/output samples scrubbed; data classification, hosting/egress approval; VS Code feasibility; approved model routes | None |
| 1 | Scaffold + synthetic demo (`coder`) | Buildable shared core, CLI/extension shell, local settings, no real data; Mac/Windows CI | Gate 0 interface decisions |
| 2 | Storage/provenance (`coder`) | Migrations, idempotency, audit states, FTS, retention, backup/restore tests | 1 |
| 3 | PR connector spike (`coder`) | Real permitted read through Locker in work environment, paginated fixture tests, safe errors; no writes | 0, 2 |
| 4 | Attention engine/UI (`coder`, `qa`) | Deterministic ranked PR/inbox list, suppressions, stale indication, accessible smoke | 2, 3 |
| 5 | Drafting/model adapter (`coder`, `security`, `qa`) | Allowed route, validated cited Markdown weekly draft, offline fallback and injection test | 0, 2, 4 |
| 6 | Meeting/Slack/Calendar/Jira adapters (`coder`, `qa`) | Scoped incremental import into review queue, not auto-approved; separate cards per source | 0, 2 |
| 7 | Evidence/review packet (`product-owner`, `security`, `coder`, `qa`) | rubric-based cited draft using approved records only, deletion/export controls and human sign-off | 0, 2, 6 |

Use separate review and QA cards when dispatcher/profile configuration supports them. Implementation changes go through repository PRs when GitHub auth, permissions and CI are ready; until then local draft work is not “merged.” Never put real work notes or test snapshots in public PRs.

### Agent-ready first implementation acceptance example

**Card:** Build local core scaffold and synthetic PR attention demo. **Repo:** `/workspace/em-os`. **Spec:** `docs/PRODUCT_SPEC.md` sections 4–6, 8–10. **Acceptance:** install/build on macOS arm64 and Windows x64; create local DB outside checkout; load synthetic PR fixture; detect review-requested and stale CI; show rationale/freshness via CLI; no outbound network required; tests for threshold, draft suppression, identity ambiguity and repeated sync. **PR:** required after auth and CI are available; include screenshots or CLI output with synthetic names only. Do not scope in Slack, personnel records or production MCP credentials.

## 12. Decisions to confirm before implementation

1. What is the approved storage location and encryption/backup policy on the work Mac and personal Windows device? May work data legally reside on the latter?
2. What are MCP Locker's concrete client interface and approved tool scopes, especially Claude-mediated vs direct use?
3. Which Claude skills are already working, where are their files, and what outputs can be preserved without migrating real notes into the public repo?
4. What LiteLLM endpoint and model IDs are work-approved, and which data classes may use Ollama/Claude Code/LiteLLM?
5. What is the canonical Foam workspace path and desired handling of local-only Markdown across machines?
6. Which PR host(s), Jira projects, Slack scopes and meeting-note source are in scope, and what action/PR thresholds feel useful rather than noisy?
7. Is the public `em-os` repo intended for reusable code only (recommended), with separate private local workspaces for actual personnel data?

## 13. Definition of done for MVP

A fresh install with synthetic fixtures on both target OSes can open a VS Code/CLI inbox, perform repeatable sync, identify at least a review owed and a stale PR with correct provenance and freshness, let the manager confirm/complete/snooze an action, generate an editable weekly Markdown draft whose claims cite actual inputs, and restore the local data from an encrypted backup. A real approved MCP read and approved work-model route are demonstrated in the work environment after gates; otherwise release remains a synthetic prototype with those integrations explicitly marked unverified. Security/QA review finds no work content in the public repo, CI artifacts or logs. The manager reviews and approves all outgoing text and performance evidence.

## 14. Yarvis architecture and library review

Reviewed [Yarvis](https://github.com/bennettaur/yarvis) at commit [`5cf6f92`](https://github.com/bennettaur/yarvis/tree/5cf6f92d8eccc825737be53672f9b6ecb174b8bb). The table below distinguishes **a reusable design or package** from **a dependency EM OS should actually take**. Versions in Yarvis's manifests are snapshots, not pins for this project. License and company dependency policy must be checked before copying any source: no `LICENSE*` file was found in this checkout, so treat Yarvis code as reference material, not code to paste.

### Important correction: OpenMemory was not selected

[Yarvis's roadmap](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/ROADMAP.md#3-memory--knowledge-follow-ups) explicitly says **`openmemory-js` was deferred** because it started its own server on import and was mid-rewrite. The shipped backend is a typed [`MemoryService`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/memory/index.ts) implemented with local Postgres + pgvector; OpenMemory was only a prospective HTTP-backed replacement. EM OS should likewise **not add OpenMemory to the MVP**. Define an internal `EvidenceSearch`/`MemorySearch` interface and use structured SQLite + FTS5 first. Reassess external memory engines only after a real semantic-recall benchmark on synthetic data, deployment/security review, and demonstrated value over FTS; any future service must remain local and independently replaceable. Do not conflate knowledge retrieval with the authoritative, human-approved personnel evidence ledger.

### Adopt / evaluate / defer

| Yarvis source and choice | EM OS decision | Why / verification gate |
|---|---|---|
| [`sidecar/package.json`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/package.json): `zod` for runtime validation | **Adopt if TypeScript core** | Parse connector responses, LLM JSON, configuration and entity DTOs at trust boundaries. Tests reject unknown/malformed identities, status and citations; don't trust types alone. |
| Same manifest: `yaml` for agent frontmatter; [parser](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/agents/frontmatter.ts) validates unknown keys | **Adopt when prompt/skill definitions are added** | Preserve reviewable Markdown specialist definitions; parse with a maintained YAML library, schema-check tools/model/classification, and load only from trusted app or explicit local directories, never an arbitrary work repo. No need for a general agent framework in MVP. |
| Same manifest: `@modelcontextprotocol/sdk` and `@ai-sdk/mcp`; [MCP client](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/mcp/service.ts) supports HTTP/stdio + OAuth | **Evaluate one client after MCP Locker spike** | Reuse a maintained SDK rather than writing protocol/OAuth transport. Pick the narrowest path that actually connects to Locker; do not install both libraries without need, duplicate its credential store, or assume Claude's configured tools are directly accessible to a VS Code extension. Tool schemas/capabilities may change: invalidate approvals on schema drift. |
| Same manifest: `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic` and others; [provider resolution](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/llm/providers.ts) distinguishes OpenAI Responses from Chat Completions | **Evaluate Vercel AI SDK for LiteLLM/Ollama calls** | Use only approved routes; test actual endpoint dialect, streaming/JSON behavior and data classes. A small Claude Code runner remains separate. Do not ship unused Bedrock/Gemini adapters or silently route to a built-in public provider. |
| [`root package.json`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/package.json): Biome, TypeScript, Bun tests, React/Vite/Playwright | **Adopt Biome + TS; evaluate test/runtime choices** | Portable TS lint/typecheck is useful; choose npm/Node or Bun on proven Mac+Windows VS Code extension-host compatibility, not Yarvis parity. React/Vite/Playwright only if the UI complexity justifies a webview; command palette + tree view may not. |
| Postgres + pgvector + Drizzle ORM (`drizzle-orm`, `drizzle-kit`) | **Keep SQLite; evaluate Drizzle SQLite adapter** | Yarvis needs relational/vector-heavy multi-process desktop data; EM OS is single-user and cross-platform with smaller scale. Drizzle may help migrations/types but driver/extension packaging and DB encryption must pass Mac arm64 + Windows x64 spikes. No Postgres service or pgvector requirement for MVP. |
| [`tasks/similarity.ts`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/tasks/similarity.ts): short-title lexical similarity | **Adopt the design, not source code** | Exact ID dedup first, then lexical proposals + manager confirmation; embeddings are not required for action-item dedup. Never silently collapse two commitments. |
| [`jobs/scheduler.ts`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/jobs/scheduler.ts): leased jobs, cursor after durable output; `croner` dependency | **Adopt semantics; defer `croner`** | MVP has manual sync. If scheduling is added, use durable job leases/ownership, explicit failure state and post-commit cursor advance; select scheduling library only when an independent host/CLI scheduler is specified. VS Code timer alone is not durable. |
| [`events/service.ts`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/events/service.ts), typed memory and [digest](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/digest/service.ts) | **Adopt boundaries** | Track meaningful source events, type and supersede derived summaries, distinguish source records, proposed inferences and approved facts. Sync external PR activity explicitly: Yarvis notes its own event log undercounts actions performed on github.com. No unreviewed rollup becomes perf evidence. |
| [`jobs/runners.ts`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/jobs/runners.ts): headless Claude Code adapter | **Evaluate for existing Claude skills** | Capture structured output from a bounded subprocess (no shell), explicit cwd, sanitized environment, timeout and tool allowlist. Confirm Locker access and approval UX; unattended jobs receive no write tools by default. |
| [`src/lib/resourceCache.ts`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/src/lib/resourceCache.ts): dedupe, stale-while-refreshing, hard expiry | **Adopt UI behavior when webview exists** | Never present an old PR state as current; show age, refresh errors and offline provenance. Implement only what the VS Code UI needs. |
| Hono HTTP sidecar, Tauri/Rust, Keychain/1Password implementation, PTYs, CodeMirror, xterm, Telegram, voice | **Defer** | Their desktop-shell/server use cases are not the MVP. Use VS Code editor/terminal and platform-approved secret storage; add an authenticated loopback service only if extension/core isolation or cross-process sync makes it necessary. |

### Design work required in discovery card (Spec 0)

- Produce a short architecture decision record with **package name/version/license/security advisory check**, Bun-vs-Node compatibility, native-binding packaging, Windows/macOS install result, and approved data egress for every adopted dependency. Reuse patterns without copying Yarvis source until license permission is verified.
- Spike two concrete paths with synthetic data: (A) direct read-only Locker connection through a maintained MCP SDK, if exposed; (B) bounded Claude Code runner using the already-configured Locker. Report capability, output structure, permission prompts and secret/log behavior; choose one ingress path or document a fail-closed fallback.
- Validate a work LiteLLM route (Responses or Chat Completions as implemented), and Ollama loopback separately. Keep models as configurable capability-tagged entries (`extract`, `draft`, optional `embed`) with per-data-class allowlists, not hard-coded brand-name fallbacks.
- Benchmark FTS5 vs optional local embeddings only on synthetic cases that FTS cannot answer. If added, stamp embedder identity/dimension and require re-index on model change, as Yarvis's [`embedder.ts`](https://github.com/bennettaur/yarvis/blob/5cf6f92d8eccc825737be53672f9b6ecb174b8bb/sidecar/src/memory/embedder.ts) does. A hash embedder can be a test fallback but is not evidence that semantic recall works.
- Update Spec 1/2 cards from this decision record; do not turn this comparison into a mandate to adopt Yarvis's entire Tauri/Bun/Postgres stack.
