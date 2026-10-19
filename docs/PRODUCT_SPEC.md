# EM OS — Product Specification

- **Status:** Draft for owner review
- **Date:** 2026-10-19
- **Owner:** David Hayes
- **Decision records:** [`docs/adr/`](adr/README.md)

## 1. Why this exists

An engineering manager's working life is a chaotic mix of meetings, Slack threads, email, PRs, tickets and documents. Commitments get made in all of them: "I'll get you that by Friday" in a DM, an action item in a transcript, a review request on a PR. They're easy to lose. Context is scattered across tools that don't talk to each other.

Notes-and-folders systems help, but they have no state and they don't push back. Lists grow until they're ignored. Structure drifts. Nothing tells you which five things matter today, or that a promise is slipping. And when review season arrives, the evidence has to be reconstructed from memory.

EM OS is a purpose-built tool for this job. It continuously gathers what's happening across the manager's sources into one local, dated, searchable store, and from that:

- extracts commitments in both directions;
- plans the day around meetings and goals;
- answers questions with links back to sources;
- drafts updates, brag docs and promotion packages from a cited record of what actually happened.

**North-star question:** *"Given my goals, my meetings and what I've promised, what should I do next, and where's the evidence?"*

**Delivery principle:** every phase ships something the user opens every morning, using real data. The tool earns trust by being used, not by being designed in the abstract.

## 2. Who it's for

- **Primary user:** a single engineering manager. They have several direct reports, a heavy meeting load, and are often still hands-on with code. They work mostly in VS Code.
- **Anyone, anywhere:** no employer-specific tool, workspace, person, naming convention or vendor may be hardcoded. Every source is a plugin and every org-specific value is configuration.
- **Not users:** direct reports and stakeholders are *subjects* of records. They never log in, and nothing is shared with them automatically.

## 3. Goals

| # | Goal | In practice |
|---|---|---|
| G1 | Track work across chat, meetings, email and calendar | Connectors gather source items into a local store on a schedule. Every item is dated and links back to its source. |
| G2 | Keep PR throughput flowing | A PR health view of the team's open PRs: age, waiting on review, CI failing, stale. Signals point at stuck *work*, not slow *people*. |
| G3 | Weekly / on-demand project and team updates | Drafts are built from completed work, merged PRs, closed tickets, decisions and notes. Every claim is cited. Output is editable Markdown plus a chat-ready copy. Never auto-sent. |
| G4 | Semantic search with source links | An ask box answers questions over local data (date-scoped, then hybrid keyword + embedding search), optionally plus live MCP sources. Citations are clickable. |
| G5 | Baseline for brag docs and promotion packages | An accomplishments ledger is fed by completed commitments and the end-of-day wrap. Packages are drafted against a user-supplied rubric. |
| G6 | Track my commitments | Promises the manager made in chat, meetings, email or by hand become commitments with an owner, a due date and a source. |
| G7 | Track commitments made to me | A "waiting on" list: what others owe the manager, with due dates and overdue flags. |
| G8 | Plan today around goals and free time | Today's meetings, prep needed, and "do these 5", fitted into free blocks around meetings. An on-demand "plan my day" narrative is also available. |
| G9 | Goals layer | Quarterly priorities, team projects and personal growth goals. Commitments and tickets link to goals. The daily plan reserves room for goal-advancing work so urgency doesn't crowd out importance. |
| G10 | Done detection and decay | The tool proposes "looks done" when the evidence appears (replied in thread, PR merged, ticket closed, doc shared). Untouched undated items get a "still relevant?" prompt. |
| G11 | End-of-day wrap | A two-minute ritual: confirm done, roll over or drop, glance at tomorrow. This produces the accomplishment record. |
| G12 | A profile per person, with manual notes | For every report and key stakeholder: commitments both ways, PRs, tickets, recent 1:1s, their brag doc, themes, "raise next time". The manager can add dated notes to anyone's profile at any time. |
| G13 | Brag docs shared with me | Brag/accomplishment docs that reports and peers share with the manager are pulled into the semantic layer, dated per entry, and surfaced on their profile, in 1:1 prep and in promotion packages. |
| G14 | Track tasks from ticketing systems | Tickets (Jira, Linear, GitHub Issues, …) for the manager and the team: assigned, blocked, stale, overdue. They link to commitments, PRs and goals, with a ticket health view. |
| G15 | Everything dated; age out or exclude | Every record has an occurred-at date. Retrieval is date-scoped *first*, then semantic. Retention policies archive or purge old items, and exclusion rules remove sources, ranges or people entirely. |
| G16 | Right model for each task | Models from all configured providers (Claude, a LiteLLM gateway, local Ollama, …) are auto-selected per task by capability, cost and data sensitivity. The user can see and override every choice. |
| G17 | Usable from other tools | The backend runs separately from any UI. It exposes a client API and an MCP server, so Claude Code (or any MCP client) can query EM OS data, and a different UI or host can be added later. |

### Success looks like

1. Within two weeks of Phase 1, the user opens EM OS every morning as their primary planning tool.
2. The triage accept rate (proposed items accepted rather than rejected) is ≥ 70% after two weeks on real data, tracked in-app as the noise metric.
3. The active commitments list stays under ~60 items without manual purging.
4. A weekly team update takes under 10 minutes from "draft" to "sent", with every claim traceable.
5. "What did we decide about X last month?" is answered correctly with a working source link, from either the ask box or Claude Code via MCP.

## 4. Non-goals and anti-goals

**Non-goals:**

- multi-user or team-facing views;
- a hosted/cloud SaaS backend or cross-device sync;
- mobile;
- autonomous writes to chat, tickets, code hosts or email (drafts go to the editor or clipboard, and the human sends);
- replacing PR review, the IDE, the ticketing system or a coding agent;
- an HR system of record.

**Anti-goals (failure even if it technically works):**

- **A noisy list.** Precision beats recall. A list full of non-commitments trains the user to ignore it.
- **Surveillance.** No per-person productivity scores, leaderboards, velocity rankings or sentiment inference. PR and ticket age are workflow signals.
- **Confident fiction.** No uncited claims. No invented links. Stale data is never presented as current.
- **Ceremony that blocks use.** Safety comes from sensible defaults (local data, read-only sources, sensitivity levels), not approval gates that keep the tool on fake data.
- **Hardcoded employer.** An org name, workspace id or internal tool name in core code is a bug.
- **Wall of text.** The UI is visual first: timelines, cards, chips, charts. Prose lives behind a click.
- **Old noise forever.** Two-year-old chatter outranking last week's decision in search is a failure. That's what G15 is for.

## 5. Experience

The visual direction is a dark/light theme-aware, VS Code-native feel with a timeline-and-cards layout. The first client is a VS Code extension (ADR 0010). Everything below is a *client* feature backed by the service API, so another client could render it differently.

### 5.1 Dashboard (full editor tab)

A grid of **widgets** that the user can add, remove and rearrange. The layout persists. Default layout:

- **Header strip:** date, meeting count, free hours today. Chips for *N to triage*, *N PRs stuck*, *N tickets blocked*, and *synced Xm ago* (red if a source is failing).
- **Week load:** five days (configurable) as meeting-load bars, with due items attached to their day. Overloaded days are highlighted.
- **Today timeline:** meetings as blocks with prep chips (*prep*, *slides missing*, *ready*), free gaps as hatched focus blocks with a suggested task, and a "now" line.
- **Do these 5:** numbered cards, each with a source icon, a title and a *why* chip ("meeting 1pm", "you promised Mon", "waiting on you 4d", "advances Q4 goal"). A progress ring shows done/5. One click checks off, snoozes or opens the source.
- **Waiting on others:** person, item, due/overdue.
- **PR health:** the team's open PRs grouped by state (needs review / CI failing / changes requested / stale) with age bars. Review requested from me comes first.
- **Ticket health:** the team's in-flight tickets by state, blocked and stale items, sprint/iteration progress if available, and my assigned tickets.
- **Observability:** plugin-provided graphs, e.g. error rate for configured services.
- **Ask box:** opens Ask (§5.4).

### 5.2 Sidebar (compact, always available)

Shows:

- next meeting with countdown and prep status;
- the top 3 "now" items;
- the triage badge;
- today's progress;
- a link to open the dashboard.

### 5.3 Triage inbox

Every machine-proposed item lands here: commitments, waiting-on items, "looks done", "still relevant?", evidence candidates, newly discovered brag docs, and proposals from MCP clients.

- Cards show the source quote, who, the date, the inferred due date, the confidence, and the proposed target (new item or *merge into* an existing one).
- One keystroke each: **Accept** (optionally edit), **Merge into…**, **Snooze**, **Reject with reason**. The reason chips are *not a commitment*, *not mine*, *FYI only*, *already done*, *too vague* and *duplicate*.
- Rejections and edits are training signal (§7.3). Triage suggests rules when patterns emerge ("You rejected 9 of 10 from #general, mute this channel?").
- The goal is to clear 15 items in under 2 minutes, fully from the keyboard.

### 5.4 Ask

- A chat-style panel. Answers carry inline citations that open the local record or the external URL.
- Every query is **date-scoped first**. The applied range is shown as an editable chip ("last 90 days", "Q3", "all time incl. archive"), inferred from the question or the default window.
- A toggle also queries live MCP sources, read-only.
- A "plan my day" preset narrates the day plan from the ranked list and the calendar.

### 5.5 Person profile

- **Header:** name, role, relationship (direct report / manager / peer / stakeholder), pronouns, identities per source, time zone.
- **Sections:**
  - commitments both ways;
  - open PRs and tickets;
  - recent 1:1s (summaries + links);
  - **their brag doc** (latest entries, new since last 1:1);
  - recurring themes;
  - raise next time;
  - **notes** (manual and imported, dated, with sensitivity);
  - growth goals.
- **Add note:** available from the profile, from the command palette ("EM OS: Note about…") and from the sidebar. It needs only a person and text. The date defaults to today and can be backdated. Tags are optional, and sensitivity defaults to `people_sensitive`. A note can link to a source (paste a URL).
- **Pronouns:** unknown pronouns are shown as *unknown, using they/them* with an invitation to confirm. Generated prose never infers pronouns from a name.

### 5.6 Meeting prep

- **1:1s:** the profile summary plus agenda candidates (open items both ways, new brag-doc entries, raise-next-time).
- **Recurring team meetings:** the last occurrence's open action items.
- **Others:** attendees, related threads, docs and tickets found via search, and commitments linked to the meeting.

Prep status is derived from linked commitments.

### 5.7 End-of-day wrap

Triggered by a command or a configurable nudge time. The steps are:

1. Today's items: done / roll to tomorrow / re-date / drop.
2. Optionally, one line of "anything else worth remembering".
3. Accept proposed accomplishments.
4. Preview tomorrow.

### 5.8 Writing: updates, brag doc, promotion package

1. Pick the type, period and audience.
2. The tool shows the evidence it will use, and the user includes or excludes items.
3. A model drafts from that set only. Citations are validated (§9).
4. The draft opens as Markdown in a user-chosen folder, with "Copy for chat".

Promotion packages for a report draw on approved evidence *and* that person's own brag doc entries. They require a rubric document, and gaps against the rubric are reported.

### 5.9 Settings and onboarding

The first-run wizard covers:

- your identity and handles;
- display time zone and work week;
- team roster;
- connectors and their MCP servers;
- meeting classification rules (title patterns → 1:1 / standup / other);
- repos, projects and services to watch;
- model providers (§8);
- retention defaults (§7.6).

Settings views include **Models** (job → selected model, why, override) and **Retention & exclusions**.

**Connecting sources (the discovery step).** Nobody should have to hand-write tool mappings:

1. **Find servers.** Auto-detect MCP servers already configured for Claude Code and VS Code (`~/.claude.json`, project `.mcp.json`, VS Code `mcp.json`) and offer "Use these". Servers can also be added by hand.
2. **Enumerate tools.** Connect and call `tools/list`, then show a catalog grouped by server, and by provider and service when an aggregator adapter provides that (§11). Each tool is classified **read** or **write**: use the MCP `readOnlyHint` annotation when present, otherwise the verb in the name. `get`, `list`, `search`, `read`, `fetch` and `query` are read; `create`, `update`, `delete`, `send`, `post`, `share`, `move`, `trash`, `set` and `respond` are write. Write tools can't be selected.
3. **Match capabilities.** For each connector capability (e.g. `calendar.listEvents`), suggest the best-matching read tools by name, description and input schema, highest-ranked first. Known presets pre-fill the matches.
4. **Test and preview.** Run one call, show the mapped result ("Found 12 meetings: Standup Tue 9:00, …"), then save as a preset.

**Trust and exit.** These are always available from the command palette and Settings:

- **Health:** the `emos doctor` checks as a panel: service, data folder, keychain, each connector, models, embedder.
- **Open data folder.**
- **Export my data:** a zip of JSON per entity plus a Markdown rendering of people, notes, commitments and meetings.
- **Delete all my EM OS data:** it requires typing `delete`, then stops the service, removes the data folder and keychain entries, and revokes MCP client tokens.

## 6. Architecture

```text
 Clients                         ┌──────────────────────────────────────────────┐
 ───────                         │              EM OS service (emosd)           │
 VS Code extension ──client API─▶│  API layer: HTTP+JSON, event stream (SSE/WS) │
 CLI (emos) ────────client API─▶│  MCP server: stdio launcher + HTTP endpoint  │
 Claude Code / any MCP client ─▶│──────────────────────────────────────────────│
 (future) web UI, other editors  │  core: domain · ranking/planner · pipelines  │
                                 │  · triage learning · retrieval · drafting    │
                                 │  · model router · scheduler · importers      │
                                 │──────────────────────────────────────────────│
                                 │ Store │ Connectors │ LLM providers │ Embedder│
                                 └───┬───────┬────────────┬──────────────┬──────┘
                                     ▼       ▼            ▼              ▼
                               SQLite +   user's MCP   Claude Code CLI,  Ollama
                               FTS5 +     servers /    Anthropic API,    (local) or
                               vectors    native APIs  LiteLLM gateway,  gateway
                                                       Ollama
```

- **The backend is a separate service process (`emosd`)** that owns the store, sync scheduler, pipelines, model router, connectors and secrets (ADR 0001). UIs are clients of a versioned **client API** defined in a shared contract package. Nothing in the service imports a UI framework or editor API.
- **Hosting modes:**
  1. *managed*: the VS Code extension starts the service on demand and attaches to it (default);
  2. *standalone*: the service is installed as a per-user OS background service (launchd / Task Scheduler / systemd), so it syncs with VS Code closed and any client can attach;
  3. *remote* (a dev container or a personal server): the separation makes this possible, but it's **not a supported mode in this spec** because it changes the privacy model (§10). The API must not preclude it: no assumption that client and service share a filesystem.
- **Client API transport:** loopback HTTP + event stream, authenticated with a per-install bearer token. The token is stored in the OS keychain and handed to local clients via a user-only-readable token file.
- **MCP server** (ADR 0013): EM OS exposes its own data to Claude Code or any MCP client as tools, so an agent can use EM OS as a query layer and, if needed, as an ingestion target.
- **Packages:**
  - `core` — pure TypeScript;
  - `api-contract` — schemas + typed client;
  - `service`;
  - `store-sqlite`;
  - `connectors/*`;
  - `providers/*` — LLM and embedding;
  - `mcp-server`;
  - `extension` — the VS Code client;
  - `cli`;
  - `importers/*`.
- **Data location:** the OS per-user app-data directory. The service refuses to start if that directory is inside a git checkout.
- **Platforms:** macOS arm64 primary. Windows x64 is kept buildable: CI builds and unit-tests both, but manual testing is macOS-only until a Windows user exists.
- **Distribution:** published to the **VS Code Marketplace** and **Open VSX** (for VS Code forks), with auto-update coming from the gallery. GitHub Releases carry the same VSIX for manual install. If the service needs native modules, publish platform-specific VSIXs (`darwin-arm64`, `win32-x64`). Installing must never require a separate Node.js install. The listing includes a README with screenshots, an icon, the MIT licence and a privacy statement (what's stored locally, what's sent where).
- **Bundled:** the VSIX includes the service and the `emos` CLI. "Usable by anyone" is delivered through interfaces plus one preset per connector kind. Additional presets come when someone needs them.

## 7. Domain model and core behaviour

### 7.1 Entities (contract, not final DDL)

**Every entity carries `occurred_at`** (when it happened in the world, from the source) **and `captured_at`** (when EM OS learned of it), plus `updated_at`. Entities with no natural date use `captured_at` as `occurred_at`. They also carry a `retention_state` (`active`, `archived`, `excluded`, `purged`) — see §7.6.

| Entity | Key fields (beyond the common date/retention fields) |
|---|---|
| `person` | display name, relationship (`self`, `direct_report`, `manager`, `peer`, `stakeholder`, `other`), role, pronouns (nullable = unknown), time zone, active/archived |
| `identity` | person, source (`chat`, `code_host`, `email`, `calendar`, `tickets`, `docs`…), handle/external id, confirmed flag. People are never auto-merged by display name alone. |
| `source_item` | connector, external id (unique per connector), kind (`message`, `thread`, `email`, `event`, `transcript`, `doc_section`, `pr`, `ticket`, `note`), url, author identity, text/excerpt, content hash, origin (`connector`, `import`, `mcp_ingest`, `manual`) |
| `commitment` | title, notes, direction (`mine`, `owed_to_me`), owner, counterpart, due (date or datetime + tz), priority (p0–p3), urgency (`now`, `next`, `soon`, `later`, `someday`; nullable), tags, status (`proposed`, `active`, `snoozed`, `done`, `dropped`), drop_reason (`user`, `stale`, `archived_on_import`, `merged`), completed_at, goal, meeting, linked tickets/PRs, sources (many-to-many), created_by (`user`, `extractor`, `import`, `mcp`), audit trail |
| `goal` | title, subject person (default self; a direct report for their growth goals), horizon (`quarter`, `half`, `ongoing`), kind (`team`, `project`, `personal_growth`), status, target date, sensitivity |
| `meeting` | calendar event id, title, start/end, attendees, classification (`one_on_one`, `standup`, `team`, `external`, `other`), person (1:1s), notes (source items), prep status, other attendees' action items (stored here, not on the user's list) |
| `pr` | code host, repo, number, url, author, reviewers requested, state, draft, CI status, review state, created/updated/last-activity, waiting-on, linked ticket keys |
| `ticket` | system, key, url, title, type, status + status category (`todo`, `in_progress`, `done`), assignee, reporter, priority, due date, sprint/iteration, epic/parent, labels, blocked flag/links, created/updated/resolved, last status change |
| `document` | connector, url, title, owner person, kind (`brag_doc`, `design_doc`, `rubric`, `other`), shared_with_me flag, last modified; content lives in `doc_section` source items, each with its own date |
| `person_note` | subject person, date (user-settable), text, tags, sensitivity (default `people_sensitive`), origin (`manual`, `import`, `mcp`), optional source link |
| `accomplishment` | subject (self or report), summary, impact, date, goal/competency tags, sources, sensitivity, status (`proposed`, `accepted`) |
| `risk`, `decision` | title, status, owner, date, links, corroborating source items |
| `triage_decision` | proposal snapshot, action, reason chip, edits diff, date — training signal |
| `rule` | suppress/boost rules by connector, channel, person or pattern; retention and exclusion rules (§7.6) |
| `chunk` | owner record, text span, **occurred_at (inherited)**, **sensitivity (per chunk)**, embedding, embedder id + dimension |
| `draft` | type, period, audience, input record ids, file path, model run metadata |
| `model_run` | job, provider, model, prompt version, input ids, token/call counts, latency, outcome (no raw prompt text) |
| `sync_state` | connector + scope, cursor, last success/error, counts |

### 7.2 Commitment capture pipeline (G6, G7)

1. **Fetch.** Connectors write dated `source_item`s. Each connector declares which items are candidates: messages *by* me, mentioning or DMing me, threads I'm in, transcripts and notes of meetings I attended, and emails I sent or was directly addressed in.
2. **Pre-filter (deterministic).** Drop items that hit suppress or exclusion rules, fall outside the lookback window, or come from bots. Then assign a **provisional sensitivity**: each connector declares a default per item kind. DMs, 1:1 meeting notes and transcripts, and email default to `people_sensitive`; channel messages, PRs and tickets default to `normal`. Provisional labels are then refined by `sensitivity.classify`, which only runs on a model approved (§8) for the provisional level. With no approvals configured, that means a local model.
3. **Extract** (model job `commitment.extract`, structured output). Each batch is a thread or a meeting. The output is zero or more `{direction, owner, counterpart, title, due, confidence, quote_span}`. The prompt includes the user's identity and roster, plus the k most similar past triage decisions as few-shot examples. Source text is data, and any instructions inside it are ignored.
4. **Resolve** people via `identity`. Unknown people are surfaced in triage and never created silently.
5. **Dedup** against active and proposed commitments with the same counterpart: embedding similarity plus a due-date window. A match proposes *merge into*.
6. **Propose** to triage. Only the user's own manual entries skip triage, and per-source auto-accept is opt-in.

Other attendees' action items are kept on the meeting record, not on the user's list.

### 7.3 Learning from triage

Learning is retrieval-based, with no model training:

- Every triage decision is embedded, and extraction retrieves similar past decisions as examples.
- Accept rates are tracked per connector, channel and person. When a scope has ≥ 8 decisions and < 20% acceptance, triage suggests a suppress rule. The user confirms; nothing is muted silently.
- Each connector has an adaptive confidence threshold. Items below it go into a collapsed "low confidence" group.

### 7.4 Done detection and decay (G10)

- **Signals checked per sync:**
  - the user replied in the source thread after the commitment;
  - a linked PR merged;
  - a linked ticket moved to done;
  - a doc or link was shared to the counterpart;
  - the meeting the commitment was for has passed.
- **Ambiguous cases** go to the model job `commitment.done_check`.
- **Output:** a "looks done" proposal. Nothing is auto-completed.
- **Decay:** undated active items untouched for 14 days (configurable) get a "still relevant?" proposal.
- **Re-sync** never reopens done or dropped items.

### 7.5 Daily ranking and planning (G8, G9)

Ranking is **deterministic and explainable**. A model may narrate the plan but never reorders it. The score components, in order:

1. **Time-critical:** prep for meetings within ~24h; due today or tomorrow.
2. **Hard-dated commitments:** proximity to the due date; overdue boosts.
3. **Waiting on me:** age. This covers PR review requests, owed replies, and tickets assigned to me that are blocking others.
4. **Goal advancement:** one slot (configurable) reserved for the best goal-linked item.
5. **Manual pin / priority / urgency:** `now` boosts; `later` and `someday` remove the item from the top 5 unless it's dated.
6. **Penalties:** snoozed, low confidence, stale source data.

Each item exposes its dominant component as the *why* chip and the full breakdown in a tooltip. Ties break by due date, then by `captured_at`.

**Tickets assigned to me** don't flood the list. They become ranking candidates only when they are due soon, blocked on me, or explicitly pinned (configurable).

**The planner** fits ranked items into free calendar blocks:

- blocks must be at least 15 minutes and within working hours;
- each item has an effort estimate, user-set or a default per kind;
- unplaceable items are flagged;
- it never edits the calendar.

### 7.6 Time, retention and exclusion (G15)

- **Dated everything.** Every record and chunk has `occurred_at`. Sources that carry a time (messages, events, ticket transitions, doc revisions) use it. Living documents such as brag docs are chunked per entry or section. Each section's date is parsed from its heading or bullet ("2026-09 — shipped X") or, failing that, set to the time the section was first seen.
- **Retention policy per record kind and connector:**
  - **active window** — included by default in retrieval and ranking (default 180 days for chat, email and transcripts; indefinite for commitments, notes, accomplishments and decisions);
  - **archive after** — excluded from default retrieval, but still available when a query sets an explicit range or "include archive";
  - **purge after** (optional, off by default) — the content and embeddings are deleted, and only a tombstone with date, source and kind remains.
- **Exclusion rules:** by date range, connector, channel/project, person or tag. Excluded items are never retrieved, ranked, sent to a model or exposed over MCP. Optionally they're purged.
- **Retrieval order:**
  1. resolve the time scope: explicit filter, a range inferred from the question (model job `ask.time_scope`, structured), or the default active window;
  2. SQL pre-filter on `occurred_at` and `retention_state`;
  3. hybrid search within that set;
  4. recency decay in fusion (configurable half-life; disabled when the user gave an explicit range).

  The applied scope is always shown.

### 7.7 Semantic layer and Ask (G4, G13)

- **Indexing:** source items, document sections, notes, commitments, decisions and profiles are chunked (structure-aware, ~300–500 tokens) and embedded via the configured embedder. FTS5 indexes the same text. Chunks inherit `occurred_at` and carry their own sensitivity.
- **Retrieval:** follows §7.6. BM25 and vector cosine results are fused by reciprocal rank fusion, then the sensitivity policy filter is applied.
- **Answering** (model job `ask.answer`): the model receives the question and the retrieved chunks, and answers citing chunk ids. The validator drops or flags citations outside the retrieved set. With live MCP on, the answering agent also gets read-only MCP tools, and those results are cited by URL.
- **Reindex:** the embedder id and dimension are stamped on every chunk. Changing the embedder triggers a background reindex.

### 7.8 Brag docs shared with me (G13)

Brag docs are found three ways:

- the user registers a doc by pasting a link, or
- a docs-connector rule finds candidates (shared with me, plus a title or folder pattern such as "brag", "accomplishments", "wins"), and
- each candidate becomes a triage proposal ("Is this Sam's brag doc?").

Once confirmed, a doc becomes a `document(kind = brag_doc, owner = person)`:

- It's re-synced on change. Changed or new sections become new dated `doc_section` items; old versions are kept until retention removes them.
- Sections default to `people_sensitive`.

It feeds:

- the person's profile ("their brag doc", "new since last 1:1");
- 1:1 prep;
- Ask;
- promotion package drafting, as the person's own words, distinct from the manager's observations.

### 7.9 PR and ticket health (G2, G14)

- **PRs:** the code-host connector pulls open PRs for configured repos and roster identities.

  | Signal | Default threshold |
  |---|---|
  | Review requested from me | any |
  | No reviewer activity | > 2 working days |
  | CI failing | > 1 day |
  | Open | > N days |
  | Changes requested, no update | > N days |

  All thresholds are configurable, and drafts and long-running labels can be suppressed.
- **Tickets:** the tickets connector pulls tickets for configured projects/boards and roster identities. Signals:
  - blocked;
  - in progress with no update > N days;
  - past due date or sprint end;
  - high priority and unassigned;
  - assigned to me.

  Ticket ↔ PR links come from keys in branch names, titles or ticket dev-panel links. Epics can map to goals.
- **Widgets** show distributions by age and state, never per-person rankings.

## 8. Models and routing (G16)

**Providers** (ADR 0006), configured by the user:

| Provider | What it is |
|---|---|
| `claude-code-cli` | The user's own installed Claude Code, run headless (`claude -p`, JSON output, explicit allowed tools). It reuses the user's existing Claude Code login and MCP setup. |
| `anthropic-api` | Anthropic API key, or Amazon Bedrock / Google Vertex. |
| `openai-compatible` | Any OpenAI-compatible endpoint, e.g. a **LiteLLM gateway** that fronts many models. |
| `ollama` | Local models, used for embeddings and optionally small jobs. |

**The model registry** lists every available model:

- discovered from providers (gateway model list and model-info endpoints, Ollama's local tags, known models for the API providers);
- enriched by a built-in **capability catalog** for well-known model families;
- editable by the user.

Each entry records:

- capabilities (`extract`, `classify`, `draft`, `reason`, `tool_use`, `long_context`, `embed`);
- quality, cost and latency tiers;
- context window;
- locality (local / remote);
- its **data approval**: the highest sensitivity it may receive (`normal`, `people_sensitive` or `private`). This is set **per model**, see *Approved models* below.

**Approved models.** Organisations often keep an internal list of models approved for PII or sensitive data. EM OS mirrors that with a per-model data approval:

- **Sources, in precedence order:**
  1. an explicit per-model setting in Settings → Models;
  2. an entry in the user's **approved-models list** (`approved-models.yaml` in the config directory, importable and replaceable as a whole). It maps `provider:model-id` to an approval level, with an optional `basis` (e.g. "internal PII list", a link), an `approved_on` date and an optional `review_by` date;
  3. the provider default: `normal` for remote providers, `private` for local loopback providers (Ollama).
- **Exact ids by default.** Glob patterns (e.g. `litellm:claude-*`) are allowed only with an explicit `pattern: true`, and Settings shows which discovered models each pattern currently matches. A model newly appearing on a gateway therefore never silently inherits sensitive approval.
- **Visibility:** each model shows its approval level and basis. A `review_by` date that has passed shows a reminder, and the approval stays in force until the user changes it. Every `model_run` records the approval level and basis that allowed it.
- **Embedders** follow the same rule: a chunk is embedded only by an embedder approved for its sensitivity, otherwise it's keyword-searchable only.

**Jobs declare requirements:**

| Job | Needs | Preference |
|---|---|---|
| `commitment.extract` | extract, quality ≥ 2 | cost |
| `commitment.done_check`, `sensitivity.classify`, `ask.time_scope` | classify | cost / latency |
| `ask.answer` | reason (+ tool_use if live MCP), long_context | quality |
| `draft.update`, `draft.brag`, `draft.promo` | draft, long_context, quality 3 | quality |
| `plan.narrate` | draft | latency |
| `embed` | embed | locality (local first) |

**The router** works like this:

- **Selection:** it filters the registry by capability, by the sensitivity of the job's input, and by provider health. It then picks deterministically by the job's preference.
- **Overrides:** the user sees *job → chosen model → why* in Settings and can pin a model or reorder fallbacks for any job.
- **Fallback:** only to models that pass the same policy. Each fallback is recorded in `model_run` and shown.
- **No silent egress:** if no model qualifies, the job fails visibly. It never routes sensitive data to a provider that isn't allowed to receive it.

**Evaluation:** a small synthetic eval set per job (later phase) lets the user compare candidate models before switching. Capability tags are only as good as their metadata; the catalog plus evals is how auto-selection earns trust.

**Usage guard:** a daily budget per provider (tokens or call count). Exceeding it pauses background jobs with a notice. User-initiated jobs continue.

## 9. Provenance and citations

- Every derived thing — commitment, accomplishment, note, draft claim, answer — links to the `source_item`s that support it. "Open source" is always one click away.
- Drafts and answers cite record ids. The validator ensures cited ids exist and were in the input set. Failures are shown, not hidden.
- **Links are rendered only from stored source URLs, never from model output.** A source without a URL opens the local record.
- Freshness is visible per widget and per answer. Cached data stays usable offline, with its age shown.

## 10. Privacy and safety

- **Local-first.** Data lives in the per-user app-data directory. Nothing leaves the machine except calls to the providers the router selects, the embedder (local by default) and the user's MCP servers.
- **No telemetry.** Logs contain ids and counts, not content.
- **Read-only to the outside world.** Connector tool allowlists are enforced in code. No model gets write tools on external systems. EM OS's own MCP server allows writes only as *proposals* into triage (ADR 0013).
- **Sensitivity levels, per chunk:**
  - `normal`.
  - `people_sensitive` — profile notes, brag docs of others, 1:1 career/wellbeing/feedback sections, promotion material. This level is:
    - never auto-accepted;
    - excluded from team-audience drafts;
    - shown in Ask or MCP only when the query is about that person or "include sensitive" is set;
    - sent only to models approved for `people_sensitive` or `private` (§8).
  - `private` — sent only to models explicitly approved for `private` (by default, local models only), and **never exposed over MCP**, because EM OS can't know which model an MCP client uses. It's embedded only by an embedder approved for `private`; otherwise it's keyword-searchable only.

  "The query is about that person" means **an explicit person target**: a person id or `people` filter, a `get_person` call, the profile view, or a roster name match in the question that's shown as a person chip the user can remove. No model infers it.

  Content without a final label carries the connector's provisional level (§7.2).

  Importers map known section headings to levels. A classification job labels unstructured text, and the user can relabel anything. A record's effective level is the maximum of its chunks.
- **Prompt injection.** Source text is delimited as data. Outputs are schema-validated, and models have no external write tools.
- **Secrets.** The service holds connector and provider secrets in the OS keychain. No secrets are kept in config files, and none are sent to clients.
- **Remote hosting** (if ever enabled) would require TLS, real authentication and a fresh look at this section. That's why it's out of scope.
- **Public repo hygiene.** The repo holds code, docs and synthetic fixtures only. CI runs a secret scanner and a fixture check (reserved example domains and names).
- **Responsibility.** Onboarding states plainly that the user must confirm their employer allows the chosen providers and MCP servers to process this data.

## 11. Pluggability

All plugins are registered in-process in the service. Loading third-party plugins dynamically is a later item.

**Connector** (`ConnectorDefinition`, ADR 0005):

- `id` and `kind`: `chat | calendar | email | meeting_notes | code_host | tickets | docs | observability`;
- a Zod `configSchema`;
- `transport`: `mcp_direct | mcp_via_agent | native`;
- the read-tool allowlist it needs;
- `sync(scope, cursor, signal) → {items, nextCursor}`, returning dated items;
- optional `liveTools` for Ask;
- optional `completionSignals(commitment)`.

Connectors are written against **capabilities**, such as `searchMessages`, `readThread`, `listTickets` or `getDocument`. **Tool-mapping presets** bind those capabilities to a particular MCP server's tool names, so one connector works across different servers. Presets are produced by the discovery step (§5.9) or shipped as known presets. Users can override any mapping.

**Aggregator adapter** (optional plugin): some MCP servers are gateways that aggregate many providers behind one login and expose their own discovery tools: provider lists, per-tool access checks, health. An aggregator adapter uses those tools to:

- group the tool catalog by provider and service;
- hide tools the user can't access, and explain why;
- show provider health;
- ship known presets for that gateway's tool names.

The core works without any adapter, using plain `tools/list`.

**Widget** (`WidgetDefinition`, ADR 0010): id, title, default size, the service query it uses, and a client render component. Connectors may contribute widgets.

**Importer** (ADR 0011): a one-time `import(path | source, {dryRun})` that writes records with `origin = import` and preserves their original dates.

**First plugin set** (the initial user's environment; all optional for others):

| Connector | First implementation |
|---|---|
| Calendar | Google Calendar |
| Email | Gmail |
| Meeting notes | Google Meet transcripts and smart notes (preferred), falling back to Gemini notes via Gmail + Drive |
| Docs | Google Drive / Docs, including brag docs shared with me |
| Chat | Slack |
| Code host | GitHub |
| Tickets | Jira |
| Observability | Datadog |

These are reached through the user's existing MCP servers where possible, otherwise through native APIs. Each has a tool-mapping preset.

## 12. Delivery phases

Each phase ends with the user working on real data. Detailed task plans are produced per phase in `docs/plans/`. Dates, retention state and sensitivity exist in the schema from Phase 1, even where the policies' UI comes later.

| Phase | Ships | Done when |
|---|---|---|
| **0. Foundations + spikes** | Monorepo, CI (macOS arm64 + Windows x64), `api-contract`, service skeleton with store + migrations, extension that starts/attaches to the service and opens a dashboard tab. Spikes, each recorded in its ADR: **(a)** service runtime (bundled Node vs. VS Code's Electron-as-Node vs. a required system Node) and SQLite driver; **(b)** direct MCP client against the user's MCP servers vs. agent-mediated; **(c)** headless `claude -p` structured output + tool restriction, plus a re-check of the terms; **(d)** LiteLLM gateway model discovery + structured output; **(e)** Ollama embedding throughput | Dashboard tab renders data served by the service on both OSes; spike decisions recorded |
| **1. Daily driver** | One-time personal-notes importer with an **import review** screen (bulk keep/drop of the active set; this review is the user's approval of imported items); manual commitments + one-line quick-capture; manual person notes; paste meeting notes into a meeting; goals; calendar connector; dashboard (header, week load, today timeline, do-these-5, waiting-on) + sidebar; deterministic ranking + planner; minimal meeting prep (1:1 open items both ways + last notes; standup open items); end-of-day wrap; onboarding; **read-only MCP server** (today, commitments, people, meetings) so Claude Code can query EM OS from day one | The user plans every morning in EM OS |
| **2. Capture + triage** | Meeting-notes, chat and email connectors; commitment extraction (back-processing pasted notes); triage inbox + keyboard flow; triage learning + rule suggestions; done detection + decay; MCP `propose_*` and `ingest_items` tools; provisional sensitivity + classification; **model registry and automatic routing** with overrides (Phase 2 is the first phase with model jobs) | The user no longer captures commitments by hand; accept rate is tracked |
| **3. Semantic layer + Ask** | Chunking, Ollama embeddings, date-first hybrid retrieval, retention/exclusion policies + settings UI; Ask panel with citations and date-scope chip; live MCP tools in Ask; MCP `search` tool; docs connector including **brag docs shared with me**; "plan my day" | "What did we decide about X last month?" answered with links, in the ask box and via Claude Code |
| **4. People + work tracking** | Full person profiles (brag doc panel, themes, raise-next-time); full meeting prep; code-host connector + PR health widget; **tickets connector (Jira) + ticket health widget**, ticket↔PR↔commitment↔goal links; observability widget | 1:1 prep comes from profiles; stuck PRs and blocked tickets surface on the dashboard |
| **5. Writing + evals** | Accomplishments ledger, update/brag/promotion drafting with citation UI (promo uses reports' brag docs), per-job model eval sets | Weekly update in under 10 minutes; brag doc current without manual effort |

## 13. Quality bar

- **Tests:**
  - `core` is unit-tested with a fake clock, store and providers: ranking, planner, dedup, time scoping, retention, router selection, citation validation, triage learning, importer parsing.
  - `api-contract` has round-trip tests, and the service has API integration tests.
  - Connectors are contract-tested against recorded synthetic fixtures.
  - The MCP server is tested with an MCP client harness.
  - There's an extension smoke test in the VS Code test host.
- **Determinism:** ranking, planning, routing and retrieval filtering are pure functions of state + clock + config.
- **Time:** stored UTC and displayed in the configured time zone, with DST fixtures for the planner and week view.
- **Accessibility:** keyboard-complete triage and dashboard. Theme colours only, with adequate contrast in light and dark themes.
- **Performance (initial):**
  - dashboard data in < 500 ms from the service;
  - sync never blocks clients;
  - date-scoped hybrid retrieval over ~50k chunks in < 300 ms.

## 14. Design calls made during review (owner to confirm)

1. Phase 1 includes minimal 1:1 and standup prep.
2. Sensitivity is per chunk/section, not per document.
3. Email commitment extraction ships in Phase 2 with chat and meeting notes.
4. A read-only MCP server ships in Phase 1, with search in Phase 3 and proposal/ingest tools in Phase 2.
5. Remote hosting is enabled by the architecture but not supported in this spec.
6. Data approval is **per model**, sourced from Settings or an approved-models list that mirrors the organisation's PII list (owner decision). Unlisted remote models default to `normal`. Patterns require explicit opt-in, so new gateway models never silently inherit sensitive approval.
7. Default active window is 180 days for chat, email and transcripts, and indefinite for commitments, notes, accomplishments and decisions. Purge is off by default.
8. Tickets assigned to the user enter the daily ranking only when due soon, blocking others, or pinned.
9. Brag-doc discovery always goes through triage confirmation. It's never auto-attached to a person.
10. Imported items are approved through the Phase 1 import review screen rather than the Phase 2 triage inbox. Non-qualifying open todos import as `dropped` with reason `archived_on_import`, still searchable and restorable.
11. Unclassified content carries a provisional sensitivity per connector and item kind (DMs, 1:1s and email → `people_sensitive`). The classifier only runs on models allowed to see that level.
12. "About that person" is an explicit target (id, filter, profile, or a visible roster-name chip), never a model inference.
13. MCP clients each get their own token and policy, so per-client sensitivity rules actually mean something.
14. If the direct MCP spike fails for a server, the fallback order is `native` → `ingest_items` via a Claude Code skill → `mcp_via_agent`. Agent-mediated results are parsed from the verbatim tool-result blocks, never from model prose, and are only allowed when the Claude model used is approved for the source's provisional sensitivity.
15. Distribution is via the VS Code Marketplace and Open VSX (owner decision), with no separate Node install. Windows is kept buildable and unit-tested, but manually tested only on macOS for now.
16. Source setup uses discovery (detect servers → `tools/list` → read/write classification → capability matching → test preview), so users never write mapping YAML by hand. Gateway-specific discovery lives in optional aggregator adapters.

## 15. Builder's discretion

Decided by the implementer and recorded in ADRs:

- client UI framework and charting library;
- SQLite driver and service runtime (subject to the Phase 0 spike criteria);
- monorepo tool and test runner;
- API transport details (SSE vs WebSocket);
- chunking parameters;
- effort defaults;
- score weights (subject to the §7.5 ordering);
- the capability catalog's initial contents.
