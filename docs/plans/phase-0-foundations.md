# Phase 0: Foundations + Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Team protocol: [README.md](README.md).

**Goal:** A buildable monorepo where the VS Code extension starts or attaches to the local EM OS service and renders a dashboard tab with data the service serves, on macOS arm64 and Windows x64. The five spikes have recorded decisions.

**Architecture:**

- A Node service (`@emos/service`) owns a SQLite store and exposes an authenticated loopback RPC + SSE API defined in `@emos/api-contract`.
- The VS Code extension is a thin client. It launches or attaches to the service and proxies RPC calls for Preact webviews.
- `@emos/core` holds pure domain logic behind ports.

**Tech Stack:** Node 24 LTS (matches the bundled runtime, ADR 0001), TypeScript 5 (strict, ESM), npm workspaces, Biome, Vitest, esbuild, Zod, Preact, `@vscode/test-electron`, `@vscode/vsce`, GitHub Actions.

**Spec:** [`docs/PRODUCT_SPEC.md`](../PRODUCT_SPEC.md) §§6, 12. ADRs [0001](../adr/0001-backend-service-and-clients.md), [0002](../adr/0002-local-sqlite-store.md), [0003](../adr/0003-hybrid-search-local-embeddings.md), [0005](../adr/0005-pluggable-connectors-mcp.md), [0006](../adr/0006-llm-providers-model-routing.md), [0010](../adr/0010-ui-clients-widgets.md).

## Global Constraints

- **Platforms:** macOS arm64 primary. Windows x64 is built and unit-tested in CI; manual testing is macOS only.
- **Data directory:**
  - macOS `~/Library/Application Support/EM OS/`;
  - Windows `%LOCALAPPDATA%\EM OS\`;
  - Linux (dev only) `${XDG_DATA_HOME:-~/.local/share}/em-os/`.

  The service **refuses to start if the data directory is inside a git working tree**.
- **Network:** the service binds to `127.0.0.1` only. Every request except `GET /health/ping` needs `Authorization: Bearer <token>`.
- **Secrets** live in the OS keychain via the `SecretStore` port. Never in config files, logs or API responses.
- **No telemetry.** Logs contain ids and counts, never content.
- **`@emos/core` is pure:** no imports of `node:fs`, `node:net`, `node:http`, `node:child_process`, `vscode`, SQLite drivers, MCP or LLM SDKs (enforced by lint in P0-01).
- **Storage formats:** timestamps are ISO-8601 UTC strings (`2026-10-20T16:00:00.000Z`); date-only values are `YYYY-MM-DD` with a separate IANA time-zone field.
- **Webviews:**
  - VS Code theme CSS variables only;
  - a strict CSP (`default-src 'none'; script-src 'nonce-…'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:`);
  - bundled assets only;
  - no `@vscode/webview-ui-toolkit`.
- **Public repo:** synthetic fixtures only (`example.com` / `example.org` domains, synthetic names). No org-specific names or tool names in code.

## Review Focus

1. **Second service instance / stale `service.json`.** A crashed service leaves `service.json` behind, or two VS Code windows start at once. Expected: exactly one service runs; clients detect the stale pid and start a fresh one. Pinned in P0-11 (`lockfile.test.ts`) and P0-13 (`launcher.test.ts`).
2. **Port already in use.** Expected: the service picks another free port and writes it to `service.json`; clients read it. Pinned in P0-11 (`server.test.ts › falls back to an ephemeral port`).
3. **Data dir inside a git checkout, or a path with spaces/Unicode** (`C:\Users\Zoë Q\AppData\Local\EM OS`). Expected: refusal with a clear message for the checkout case, and normal operation for odd characters. Pinned in P0-10 (`paths.test.ts`).
4. **Expired or wrong token.** Expected: `401` with error code `unauthorized`. The extension re-reads the token file once, then shows "Reconnect" instead of looping. Pinned in P0-11 and P0-13.
5. **Service not reachable from the webview.** Expected: the dashboard shows a "Service unavailable — Retry" state, not a blank panel. Pinned in P0-14 (`App.test.tsx › renders unavailable state`).

---

## Task board

- [ ] **P0-01** Monorepo, toolchain, lint boundaries — deps: none — claim: —
- [ ] **P0-02** CI matrix + repo-safety checks — deps: P0-01 — claim: —
- [ ] **P0-03** *spike* S1: service runtime, SQLite driver, keychain library — deps: P0-01 — claim: —
- [ ] **P0-04** *spike, manual* S2: direct MCP client against the owner's MCP servers — deps: P0-01 — claim: —
- [ ] **P0-05** *spike, manual* S3: headless `claude -p` structured output + tool restriction + terms check — deps: P0-01 — claim: —
- [ ] **P0-06** *spike, manual* S4: LiteLLM gateway model discovery + structured output — deps: P0-01 — claim: —
- [ ] **P0-07** *spike* S5: Ollama embedding throughput — deps: P0-01 — claim: —
- [ ] **P0-08** `@emos/api-contract`: entities, op registry, errors, client — deps: P0-01 — claim: —
- [ ] **P0-09** `@emos/core` skeleton: ports, ids, time utilities — deps: P0-08 — claim: —
- [ ] **P0-10** `@emos/store-sqlite`: paths, driver adapter, migrations, schema 0001 — deps: P0-03, P0-09 — claim: —
- [ ] **P0-11** `@emos/service`: RPC server, auth, SSE, lockfile, health, keychain secrets — deps: P0-03, P0-08, P0-10 — claim: —
- [ ] **P0-12** `@emos/cli`: `emos doctor`, `emos backup`, `emos service start|stop` — deps: P0-11 — claim: —
- [ ] **P0-13** `@emos/extension`: activation, launcher/attach, RPC bridge, panels — deps: P0-03, P0-11 — claim: —
- [ ] **P0-14** `@emos/webview`: Preact shell, bridge client, widget grid, service-status widget — deps: P0-08 — claim: —
- [ ] **P0-15** VSIX packaging + extension smoke test in CI — deps: P0-02, P0-13, P0-14 — claim: —

Parallel lanes once P0-01 merges:

- spikes P0-03 to P0-07, in any order;
- P0-08 → P0-09 / P0-14;
- P0-02.

---

### Task P0-01: Monorepo, toolchain, lint boundaries

**Files:**
- Create: `package.json` (workspaces `packages/*`), `tsconfig.base.json`, `biome.json`, `vitest.workspace.ts`, `.nvmrc` (`22`), `.editorconfig`, `scripts/build.mjs` (esbuild driver)
- Create: `packages/core/{package.json,tsconfig.json,src/index.ts}`. This is a placeholder export so the lint test has a target.
- Test: `scripts/lint-boundaries.test.ts`

**Interfaces:**
- Produces:
  - root scripts `npm run build|test|lint|typecheck|ci`;
  - package template: `"type": "module"`, `exports` → `./dist/index.js`, `types` → `./dist/index.d.ts`;
  - the Biome `noRestrictedImports` override for `packages/core/**` that bans the modules listed in Global Constraints.

- [ ] **Step 1: Write the failing test.** `lint-boundaries.test.ts` writes a temp file `packages/core/src/__probe.ts` containing `import fs from "node:fs";`, runs `npx biome lint packages/core/src/__probe.ts`, and deletes the file in `finally`.
  ```ts
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout + result.stderr).toMatch(/noRestrictedImports/);
  ```
- [ ] **Step 2: Run `npx vitest run scripts/lint-boundaries.test.ts`.** Expected: FAIL (no Biome config yet).
- [ ] **Step 3: Add the root configs.** Settings:
  - TypeScript: `strict`, `noUncheckedIndexedAccess`, `module: NodeNext`, `target: ES2022`;
  - Biome: formatter on, recommended rules, the `packages/core/**` restricted-imports override;
  - `npm run ci` = `lint && typecheck && test && build`.
- [ ] **Step 4: Run `npm install && npm run ci`.** Expected: PASS, and the boundary test passes.
- [ ] **Step 5: Commit** `chore(p0-01): monorepo toolchain and core import boundary`.

**Acceptance:** `npm ci && npm run ci` is green on a clean clone. Importing `node:fs` in `packages/core` fails lint.

---

### Task P0-02: CI matrix + repo-safety checks

**Files:**
- Create: `.github/workflows/ci.yml`, `scripts/check-fixtures.mjs`
- Test: `scripts/check-fixtures.test.ts`

**Interfaces:**
- Produces:
  - a CI job matrix `{macos-14, windows-latest}` running `npm ci && npm run ci`;
  - a `gitleaks` job (`gitleaks/gitleaks-action@v2`);
  - `node scripts/check-fixtures.mjs [dir=fixtures]`, which exits 1 on violations.

- [ ] **Step 1: Write the failing tests.** `check-fixtures.test.ts`:
  ```ts
  it("rejects non-reserved email domains", () => {
    expect(scan("a@acme.io")).toEqual([{ rule: "email-domain", match: "a@acme.io" }]);
  });
  it("allows example domains", () => {
    expect(scan("sam@example.com https://docs.example.org/x")).toEqual([]);
  });
  it("rejects Slack-style workspace ids", () => {
    expect(scan("T02ABCDEF")[0]?.rule).toBe("workspace-id");
  });
  ```
- [ ] **Step 2: Run them.** Expected: FAIL (`scan` is not defined).
- [ ] **Step 3: Implement `export function scan(text: string): Array<{ rule: string; match: string }>`** in `scripts/check-fixtures.mjs`. Rules:
  - emails not `@example.(com|org|net)`;
  - URLs whose host isn't `example.*` or `localhost`;
  - `\bT0[0-9A-Z]{7,10}\b` (workspace-id);
  - `xox[abpr]-` tokens.

  The CLI walks `fixtures/**` and `packages/*/fixtures/**`.
- [ ] **Step 4: Run the tests (PASS), then push the branch.** Expected: both matrix jobs and the gitleaks job are green.
- [ ] **Step 5: Commit** `ci(p0-02): os matrix, gitleaks, fixture safety scan`.

**Acceptance:** CI runs on PRs and on `main`. A fixture containing `bob@acme.io` fails the job.

---

### Task P0-03: Spike S1 — service runtime, SQLite driver, keychain library

**Files:**
- Create: `spikes/s1-runtime/` (throwaway code; delete it in the same PR after recording results)
- Modify: `docs/adr/0001-backend-service-and-clients.md`, `docs/adr/0002-local-sqlite-store.md` (append `## Spike result (YYYY-MM-DD)`)

**Interfaces:**
- Produces three decisions that P0-10 and P0-13 rely on:
  - `RUNTIME`: one of `bundled-node | electron-as-node` (`system-node` is ruled out);
  - `SQLITE_DRIVER`: one of `node:sqlite | better-sqlite3 | wasm:<pkg>`;
  - `KEYCHAIN_LIB`: e.g. `@napi-rs/keyring`.

- [ ] **Step 1: For each driver candidate, run a script under each runtime candidate on macOS arm64 and Windows x64 (CI matrix).** The script must:
  - create a DB;
  - `CREATE VIRTUAL TABLE t USING fts5(x)`;
  - insert 10k rows in one transaction and time it;
  - run an online backup to a second file;
  - open with WAL.
- [ ] **Step 2: Measure.** `system-node` is excluded: users must never install Node separately (ADR 0001). For each remaining combination, record:
  - VSIX size impact;
  - whether install needs network or a postinstall step;
  - whether standalone mode works with VS Code closed;
  - whether it needs platform-specific VSIXs (`vsce package --target darwin-arm64|win32-x64`) for Marketplace / Open VSX.
- [ ] **Step 3: Store and read a test secret** via the keychain library candidate on both OSes, under the chosen runtime.
- [ ] **Step 4: Write the results table and the three decisions into ADR 0001/0002.** Pick the simplest combination that passes ADR 0002's criteria.
- [ ] **Step 5: Delete `spikes/s1-runtime/` and commit** `docs(p0-03): record runtime, sqlite driver and keychain decisions`.

**Acceptance:** The ADRs name exactly one choice for each of `RUNTIME`, `SQLITE_DRIVER` and `KEYCHAIN_LIB`, with per-OS evidence.

---

### Task P0-04: Spike S2 — direct MCP client against the owner's servers *(manual)*

**Files:**
- Create: `spikes/s2-mcp/probe.ts` (kept as a dev tool: `npx tsx spikes/s2-mcp/probe.ts --config <path>`). Probe output is never committed.
- Modify: `docs/adr/0005-pluggable-connectors-mcp.md` (spike result)

**Interfaces:**
- Produces, per MCP server, the verdict `mcp_direct: yes|no` with the reason. It also records the auth method and whether pagination works. The record contains no tool output, server URLs or org names: servers are described generically, e.g. "aggregating OAuth gateway".

- [ ] **Step 1: Write the probe.** It uses `@modelcontextprotocol/sdk` `Client` with `StreamableHTTPClientTransport` or `StdioClientTransport`, reading server definitions from a user-supplied JSON in Claude Code `mcpServers` format. It must:
  - connect;
  - `listTools()`, and print only the count and a hash of the names;
  - call one read tool twice with a pagination cursor, and print only the item counts.
- [ ] **Step 2: The owner runs it** against each of their servers: calendar, mail, meeting notes, docs, chat, code host, tickets, observability.
- [ ] **Step 3: Record the verdicts and the fallback order** (`native` → `ingest_items` → `mcp_via_agent`) per server in ADR 0005.
- [ ] **Step 4: Commit** `docs(p0-04): record direct MCP feasibility per server class`.

**Acceptance:** Every first-plugin connector kind in spec §11 has a recorded transport decision.

---

### Task P0-05: Spike S3 — headless Claude Code *(manual)*

**Files:**
- Create: `spikes/s3-claude/run.ts` (dev tool)
- Modify: `docs/adr/0006-llm-providers-model-routing.md`

**Interfaces:**
- Produces the confirmed invocation recipe that P2's `claude-code-cli` adapter uses: the exact argv, the output format, how to restrict tools, and how to pick the model.

- [ ] **Step 1: Write the probe.** It uses `child_process.spawn("claude", ["-p", prompt, "--output-format", "json", "--allowedTools", ""], { shell: false, cwd: tmpdir })` with a 60 s timeout. It asks for a JSON object matching a Zod schema `{ items: { title: string }[] }` about synthetic text, then validates the reply.
- [ ] **Step 2: Repeat with `--output-format stream-json`** and one allowed read-only MCP tool. Confirm the `tool_result` blocks appear verbatim in the stream.
- [ ] **Step 3: Confirm a disallowed tool is refused.** Record the error shape.
- [ ] **Step 4: Re-read Anthropic's current Agent SDK / Claude Code usage terms on subscription login.** Record the conclusion and the date.
- [ ] **Step 5: Record the recipe and the conclusion in ADR 0006. Commit** `docs(p0-05): record claude -p recipe and terms check`.

**Acceptance:** ADR 0006 contains a working argv and output shape, plus a dated terms conclusion.

---

### Task P0-06: Spike S4 — LiteLLM gateway *(manual)*

**Files:**
- Create: `spikes/s4-litellm/probe.ts`
- Modify: `docs/adr/0006-llm-providers-model-routing.md`

- [ ] **Step 1: Write the probe.** It calls `GET {base}/v1/models` and `GET {base}/model/info` (if present) with the key from an env var, and prints the field names available per model, not the values.
- [ ] **Step 2: Test structured output.** Call one chat model with `response_format: { type: "json_schema", … }`, falling back to JSON-mode, and validate the reply with Zod. Record which works.
- [ ] **Step 3: Record in ADR 0006** which metadata fields exist and can feed the capability catalog, and the supported structured-output mode. Commit `docs(p0-06): record gateway discovery and structured output`.

**Acceptance:** ADR 0006 states which registry fields can be auto-discovered from the gateway and which come from the catalog.

---

### Task P0-07: Spike S5 — Ollama embeddings

**Files:**
- Create: `spikes/s5-ollama/bench.ts`
- Modify: `docs/adr/0003-hybrid-search-local-embeddings.md`

- [ ] **Step 1: Benchmark `POST /api/embed`.** Use `nomic-embed-text` and one alternative (e.g. `mxbai-embed-large`) on 2,000 synthetic 400-token chunks. Record:
  - chunks/second at batch sizes 16 and 64;
  - the dimension;
  - RSS.
- [ ] **Step 2: Measure brute-force cosine** top-50 over 50k random normalised vectors of that dimension in a worker thread. The target is < 300 ms (spec §13).
- [ ] **Step 3: Record the default model and batch size in ADR 0003. Commit** `docs(p0-07): record embedding model and throughput`.

**Acceptance:** ADR 0003 names the default embedder, its dimension and a measured throughput.

---

### Task P0-08: `@emos/api-contract` — entities, op registry, errors, client

**Files:**
- Create in `packages/api-contract/src/`:
  - `entities/common.ts`, `entities/person.ts`, `entities/commitment.ts`, `entities/goal.ts`, `entities/meeting.ts`, `entities/source-item.ts`, `entities/misc.ts` (risk, decision, document, accomplishment), `entities/index.ts` *(append-only)*
  - `op.ts`, `ops/health.ts`, `ops/index.ts` *(append-only registry)*
  - `errors.ts`, `client.ts`, `events.ts`, `bridge.ts` (webview ↔ extension protocol), `index.ts`
- Test: `packages/api-contract/src/{entities,op,client}.test.ts`

**Interfaces:**
- Produces, in `entities/common.ts`:
  ```ts
  export const IsoDateTime = z.string().datetime({ offset: false }); // UTC 'Z'
  export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  export const Sensitivity = z.enum(["normal", "people_sensitive", "private"]);
  export const RetentionState = z.enum(["active", "archived", "excluded", "purged"]);
  export const Dated = z.object({ occurredAt: IsoDateTime, capturedAt: IsoDateTime, updatedAt: IsoDateTime, retentionState: RetentionState });
  ```
- Produces the entity schemas below. Each is `Dated.extend({...})` with `id: z.string()`. The fields are exactly those in spec §7.1 for that entity. Names are camelCase:

  | Entity | Details |
  |---|---|
  | `Person` | `relationship` enum, `pronouns: z.string().nullable()`, `aliases: z.array(z.string())`, `role: z.string().nullable()`, `timeZone: z.string().nullable()`, `archived: z.boolean()`, `oneOnOneCadenceDays: z.number().int().positive().nullable()` |
  | `Identity` | |
  | `PersonNote` | `personId`, `text`, `tags`, `sourceUrl: string \| null`, `sensitivity` default `"people_sensitive"`, `origin` enum `manual \| import \| mcp`, `reviewState: "proposed" \| "accepted"` (default `"accepted"`; MCP notes start `"proposed"`) |
  | `Goal` | `title`, `slug: string \| null` (unique; used to resolve `#ws:` tags), `subjectPersonId`, `horizon`, `kind`, `status`, `targetDate: LocalDate \| null`, `sensitivity` |
  | `Commitment` | `direction`, `status`, `dropReason`, `urgency`, `priority: z.number().int().min(0).max(3).nullable()`, `due: { date: LocalDate, time: z.string().nullable(), timeZone: z.string() }.nullable()`, `tags: string[]`, `createdBy`, `ownerId`, `counterpartId: string \| null`, `goalId: string \| null`, `meetingId: string \| null`, `title`, `notes`, `pinned: boolean`, `effortMinutes: number \| null`, `snoozedUntil: IsoDateTime \| null`, `completedAt: IsoDateTime \| null`, `recurrence: { freq: "daily" \| "weekly" \| "monthly", interval: number, byWeekday: number[] \| null, byMonthDay: number \| null } \| null`, `seriesId: string \| null` (shared by all occurrences of a recurring item) |
  | `Meeting` | `connectorId`, `externalId`, `title`, `start`, `end` (IsoDateTime), `allDay`, `status: "confirmed" \| "cancelled"`, `selfResponse: "accepted" \| "tentative" \| "declined" \| "needs_action" \| null`, `classification` enum, `classificationSource: "auto" \| "user"`, `personId` (1:1s), `attendees: { identityId: string \| null, personId: string \| null, displayName, email: string \| null }[]`, `actionItems: { text: string, ownerName: string \| null, done: boolean }[]` (other attendees' items, spec §7.1), `url: string \| null` |
  | `SourceItem` | `connectorId`, `externalId`, `kind`, `origin`, `url: string \| null`, `authorIdentityId: string \| null`, `text`, `contentHash`, `sensitivity`, `sections: { heading: string, sensitivity, startLine: number }[] \| null` |
  | `Risk`, `Decision`, `Document`, `Accomplishment` | as spec §7.1 |

- Produces exported enum schemas: `Relationship`, `Direction` (`mine \| owed_to_me`), `CommitmentStatus`, `DropReason`, `Urgency`, `CreatedBy`, `Classification`, `GoalStatus`, `SourceKind` and `Origin`. Their values are exactly as listed in spec §7.1.
- Produces `AuditEvent = { id, entity: string, entityId: string, action: string, actor: "user" | "import" | "system" | "mcp", at: IsoDateTime, note: string | null, diff: Record<string, { from: unknown; to: unknown }> }`.
- Produces creation types: for each entity `X`, `NewX = Omit<X, "id" | "capturedAt" | "updatedAt">` with `occurredAt` and `retentionState` optional. They default to now and `"active"`. Also `ExternalMeeting = NewMeeting` with `connectorId` and `externalId` required.
- Produces, in `op.ts`:
  ```ts
  export interface OpDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny> { name: string; input: I; output: O; }
  export function defineOp<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(def: OpDef<I, O>): OpDef<I, O>;
  export type OpName = keyof typeof ops;               // from ops/index.ts
  export type OpInput<N extends OpName> = z.input<(typeof ops)[N]["input"]>;
  export type OpOutput<N extends OpName> = z.output<(typeof ops)[N]["output"]>;
  export type OpParsedInput<N extends OpName> = z.output<(typeof ops)[N]["input"]>;
  export const API_VERSION = 1;
  ```
- Produces `ops/health.ts`: `health.get` with input `{}` and output `{ apiVersion: number, serviceVersion: string, startedAt: IsoDateTime, dataDir: string, connectors: { id: string, state: string, lastSuccessAt: IsoDateTime | null }[] }`.
- Produces `errors.ts`: `ErrorCode = "unauthorized" | "not_found" | "invalid_input" | "conflict" | "unavailable" | "incompatible_version" | "internal"`, plus `class ApiError extends Error { code: ErrorCode }`.
- Produces `client.ts`:
  ```ts
  export interface Transport { post(path: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; json: unknown }>; }
  export function createClient(opts: { transport: Transport; token: string }): { call<N extends OpName>(name: N, input: OpInput<N>): Promise<OpOutput<N>> };
  export function httpTransport(baseUrl: string, fetchImpl?: typeof fetch): Transport;
  ```
  The wire format: `POST /rpc/<name>`, headers `Authorization: Bearer`, `X-EMOS-API: 1`. The response is `{ ok: true, result } | { ok: false, error: { code, message } }`, and the client throws `ApiError` on `ok: false`.
- Produces `events.ts`: `ServerEvent = { type: "sync.status", connectorId, state } | { type: "items.changed", entity: string, ids: string[] }`.
- Produces `bridge.ts`: the `ToHost` / `ToView` webview message types, exactly as listed in the P0-13 Interfaces block. They live here so that P0-13 and P0-14 can build in parallel.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  it("rejects non-UTC timestamps", () => { expect(IsoDateTime.safeParse("2026-10-20T09:00:00-07:00").success).toBe(false); });
  it("person pronouns may be null (unknown)", () => { expect(Person.parse({ ...basePerson, pronouns: null }).pronouns).toBeNull(); });
  it("person note defaults to people_sensitive", () => { expect(PersonNote.parse(baseNoteWithoutSensitivity).sensitivity).toBe("people_sensitive"); });
  it("client unwraps ok results and throws ApiError on errors", async () => {
    const t = fakeTransport({ status: 401, json: { ok: false, error: { code: "unauthorized", message: "x" } } });
    await expect(createClient({ transport: t, token: "k" }).call("health.get", {})).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("client sends bearer and api version headers", async () => { /* assert headers.Authorization === "Bearer k", headers["X-EMOS-API"] === "1" */ });
  ```
- [ ] **Step 2: Run `npx vitest run packages/api-contract`.** Expected: FAIL.
- [ ] **Step 3: Implement the files above.** `httpTransport` uses global `fetch`.
- [ ] **Step 4: Run.** Expected: PASS, and `npm run typecheck` is green.
- [ ] **Step 5: Commit** `feat(p0-08): api contract entities, op registry and client`.

**Acceptance:** Every entity in spec §7.1 needed by Phase 1 has a schema. The registry exposes `health.get`, and the client is fully typed by op name.

---

### Task P0-09: `@emos/core` skeleton — ports, ids, time utilities

**Files:**
- Create in `packages/core/src/`:
  - `ports/clock.ts`, `ports/ids.ts`, `ports/logger.ts`, `ports/secrets.ts`;
  - `ports/store.ts` *(append-only: each slice adds its repo field)*;
  - `time/zoned.ts`, `index.ts`
- Test: `packages/core/src/time/zoned.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Clock { now(): Date }
  export interface IdGen { next(prefix: string): string }        // e.g. "cmt_01J…"; prefixes: per, idn, pnt, gol, cmt, mtg, src, rsk, dec, doc, acc, mcl
  export interface Logger { info(event: string, fields?: Record<string, string | number | boolean>): void; warn(...); error(...) } // ids/counts only
  export interface SecretStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> }
  export interface Store { transaction<T>(fn: () => T): T }    // repos are added to this interface by later tasks (synchronous API)
  // time/zoned.ts — Intl-based, no tz library
  export function toLocalDate(instant: Date, timeZone: string): string;              // "YYYY-MM-DD"
  export function startOfLocalDay(localDate: string, timeZone: string): Date;        // UTC instant of local midnight
  export function addLocalDays(localDate: string, days: number): string;
  export function localWeekdayIndex(localDate: string): number;                       // 0=Sun … 6=Sat
  export function localMinutes(instant: Date, timeZone: string): number;              // minutes since local midnight
  ```

- [ ] **Step 1: Write the failing tests** (they pin DST):
  ```ts
  it("start of day across US DST fall-back", () => {
    expect(startOfLocalDay("2026-11-01", "America/Los_Angeles").toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(startOfLocalDay("2026-11-02", "America/Los_Angeles").toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });
  it("toLocalDate respects zone", () => {
    expect(toLocalDate(new Date("2026-10-20T05:30:00Z"), "America/Los_Angeles")).toBe("2026-10-19");
  });
  it("localMinutes", () => { expect(localMinutes(new Date("2026-10-20T16:30:00Z"), "America/Los_Angeles")).toBe(9 * 60 + 30); });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement with `Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23" })`.** For `startOfLocalDay`, compute the offset from a two-pass correction.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p0-09): core ports and zoned time utilities`.

**Acceptance:** DST tests pass on both CI OSes, and core still passes the boundary lint.

---

### Task P0-10: `@emos/store-sqlite` — paths, driver, migrations, schema 0001

**Files:**
- Create in `packages/store-sqlite/src/`:
  - `paths.ts`, `driver.ts` (adapter for `SQLITE_DRIVER` from P0-03), `migrate.ts`;
  - `migrations/0001_initial.sql`, `migrations/index.ts` *(append-only)*;
  - `open.ts`, `index.ts`
  - `store.ts`: `createStore(db)`. Each later slice adds its repo here *(append-only)*
- Test: `packages/store-sqlite/src/{paths,migrate,open}.test.ts`

**Interfaces:**
- Consumes: `Store` from `@emos/core`.
- Produces:
  ```ts
  export function resolveDataDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homedir: string): string; // EMOS_DATA_DIR overrides (tests/dev)
  export function createStore(db: Db): Store;            // store.ts — implements the core Store port; repos are appended by slices
  export function assertNotInGitCheckout(dir: string, exists: (p: string) => boolean): void; // walks parents for ".git"; throws Error("EM OS data directory is inside a git checkout: <dir>")
  export interface Db { exec(sql: string): void; prepare(sql: string): { run(...p: unknown[]): { changes: number }; get<T>(...p: unknown[]): T | undefined; all<T>(...p: unknown[]): T[] }; transaction<T>(fn: () => T): T; backup(toPath: string): Promise<void>; close(): void }
  export function openDb(file: string): Db;          // WAL, foreign_keys=ON, busy_timeout=5000, then migrate()
  export function migrate(db: Db): { applied: string[] };
  ```
- `0001_initial.sql` creates the Phase 1 tables:
  - `schema_migrations`
  - `people`, `identities` (`handle TEXT COLLATE NOCASE`), `person_notes`
  - `goals` (`slug UNIQUE`)
  - `commitments`, `commitment_sources (commitment_id, source_item_id)`
  - `audit_events` (id, entity, entity_id, action, actor, at, note, diff JSON), which records audit for every entity
  - `meetings` (including `classification_source`), `meeting_attendees`, `meeting_notes (meeting_id, source_item_id)`
  - `source_items`
  - `record_sources (entity, entity_id, source_item_id)`: source links for risks, decisions, documents and accomplishments
  - `risks`, `decisions`, `documents`, `accomplishments`
  - `settings` (key TEXT PK, value JSON)
  - `layouts`
  - `day_plans` (local_date TEXT PK, commitment_ids JSON, created_at) — the day's stable top list
  - `layouts` (surface TEXT PK, entries JSON)
  - `sync_state` (connector_id TEXT PK, cursor, state, last_attempt_at, last_success_at, last_error, item_count)
  - `mcp_clients` (id, name UNIQUE, token_hash, allow_sensitive, created_at, revoked_at)
  - `import_keys` (key TEXT PK, entity, entity_id)

  Columns mirror the P0-08 entity schemas in snake_case. Every dated table has `occurred_at, captured_at, updated_at, retention_state` and an index on `(occurred_at, retention_state)`. Also: `UNIQUE(connector_id, external_id)` on `source_items` and `meetings`, and `UNIQUE(source, handle)` on `identities`.
- **Later migrations:** a task that needs schema changes adds `migrations/<task-id>_<area>.sql` (e.g. `p1-41_recurrence.sql`) and appends it to `migrations/index.ts` *(append-only)*. Order is the order in `index.ts`.
- **Pre-migration backup:** when `openDb` opens an existing database with pending migrations, it first writes `<dataDir>/backups/pre-<first-pending-name>.db` using `Db.backup`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  it("resolves platform data dirs", () => {
    expect(resolveDataDir({}, "darwin", "/Users/zoë q")).toBe("/Users/zoë q/Library/Application Support/EM OS");
    expect(resolveDataDir({ LOCALAPPDATA: "C:\\Users\\Zoë Q\\AppData\\Local" }, "win32", "C:\\Users\\Zoë Q")).toBe("C:\\Users\\Zoë Q\\AppData\\Local\\EM OS");
  });
  it("refuses a data dir inside a git checkout", () => {
    expect(() => assertNotInGitCheckout("/r/proj/data", p => p === "/r/proj/.git")).toThrow(/inside a git checkout/);
  });
  it("migrates idempotently", () => { const db = openDb(tmp()); expect(migrate(db).applied).toEqual([]); });
  it("EMOS_DATA_DIR overrides the platform default", () => { expect(resolveDataDir({ EMOS_DATA_DIR: "/tmp/x" }, "darwin", "/Users/a")).toBe("/tmp/x"); });
  it("identity handles are unique case-insensitively", () => { /* insert ("chat","@Alex") then ("chat","@alex") → throws */ });
  it("backs up before applying a pending migration to an existing db", async () => { /* add a test migration → backups/pre-<name>.db exists */ });
  it("enforces source item uniqueness", () => { /* second insert with same (connector_id, external_id) throws */ });
  it("has occurred_at index on every dated table", () => { /* PRAGMA index_list per table includes an index whose first column is occurred_at */ });
  it("backup produces a readable copy", async () => { /* backup → openDb(copy) → same row counts */ });
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Migrations run inside one transaction per file and record their names in `schema_migrations`. `openDb` creates the parent directory with mode `0o700` on POSIX.
- [ ] **Step 4: Run.** Expected: PASS on both OSes in CI.
- [ ] **Step 5: Commit** `feat(p0-10): sqlite store, data paths and initial schema`.

**Acceptance:** A fresh DB has every Phase 1 table. Re-opening applies nothing. A checkout path is refused.

---

### Task P0-11: `@emos/service` — RPC server, auth, SSE, lockfile, health

**Files:**
- Create in `packages/service/src/`:
  - `main.ts`, `server.ts`, `rpc.ts`, `auth.ts`, `lockfile.ts`, `events.ts`, `config.ts`, `context.ts`;
  - `secrets.ts`: a `SecretStore` implementation over `KEYCHAIN_LIB` (P0-03), service name `em-os`;
  - `handlers/health.ts`, `handlers/index.ts` *(append-only registry)*
- Test: `packages/service/src/{server,auth,lockfile,rpc}.test.ts`

**Interfaces:**
- Consumes: `ops` and `ApiError` (P0-08); `openDb`, `resolveDataDir` and `assertNotInGitCheckout` (P0-10); the core ports (P0-09).
- Produces:
  ```ts
  // context.ts builds store via createStore(db) (P0-10)
  export interface ServiceContext { db: Db; store: Store; clock: Clock; ids: IdGen; log: Logger; secrets: SecretStore; events: EventBus; config: ServiceConfig }
  export type Handler<N extends OpName> = (ctx: ServiceContext, input: OpParsedInput<N>) => OpOutput<N> | Promise<OpOutput<N>>;
  export const handlers: { [N in OpName]?: Handler<N> };          // handlers/index.ts
  export interface EventBus { publish(e: ServerEvent): void; subscribe(fn: (e: ServerEvent) => void): () => void }
  export async function startService(opts: { dataDir: string; port?: number }): Promise<{ port: number; token: string; stop(): Promise<void> }>;
  ```
- Runtime files in `dataDir/run/`:
  - `service.json` — `{ pid, port, apiVersion, serviceVersion, startedAt }`;
  - `token` — the first-party bearer token, file mode `0o600`; a copy is also stored in the keychain under key `emos/token`;
  - `service.lock` — an exclusive lock file; a stale lock (dead pid) is reclaimed.
- Routes:
  - `POST /rpc/:op` — validates input with the op's Zod schema (`invalid_input` on failure) and validates the output in dev/test;
  - `GET /events` — SSE;
  - `GET /health/ping` — returns `200 ok` with no auth.

  A missing or wrong bearer gets 401 `unauthorized`. A mismatched `X-EMOS-API` gets 409 `incompatible_version`.

- [ ] **Step 1: Write the failing tests.**
  ```ts
  it("rejects missing token", async () => { expect((await post("/rpc/health.get", {}, {})).status).toBe(401); });
  it("serves health.get with a valid token", async () => { expect(res.json).toMatchObject({ ok: true, result: { apiVersion: 1 } }); });
  it("rejects invalid input with invalid_input", async () => { /* unknown op → not_found; bad body → invalid_input */ });
  it("falls back to an ephemeral port when the preferred port is taken", async () => { /* occupy port, start service with port option, expect different port in service.json */ });
  it("second startService on same dataDir throws 'already running'", async () => {});
  it("reclaims a stale lock whose pid is dead", async () => {});
  it("binds 127.0.0.1 only", async () => { /* server.address().address === "127.0.0.1" */ });
  it("streams items.changed events over SSE", async () => {});
  it("secrets round-trip through the keychain and never appear in logs", async () => {});
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with `node:http` (no framework). `main.ts` parses `--data-dir` and `--port` (default `47821`), handles SIGTERM, and writes the runtime files.
- [ ] **Step 4: Run.** Expected: PASS on both OSes.
- [ ] **Step 5: Commit** `feat(p0-11): service with authenticated rpc, sse and lockfile`.

**Acceptance:** `node packages/service/dist/main.js` starts the service. A client using the token from the token file gets `health.get`. A second start reports "already running".

---

### Task P0-12: `@emos/cli` — doctor, backup, service start/stop

**Files:**
- Create in `packages/cli/src/`: `main.ts`, `commands/doctor.ts`, `commands/backup.ts`, `commands/service.ts`, `commands/index.ts` *(append-only)*
- Test: `packages/cli/src/commands/*.test.ts`

**Interfaces:**
- Consumes: `createClient` and `httpTransport` (P0-08); `startService` and the runtime file layout (P0-11).
- Produces:
  - the `emos` bin;
  - `export interface Command { name: string; summary: string; run(args: string[], io: { out(s: string): void; err(s: string): void }): Promise<number> }`;
  - exit codes: `0` ok, `1` failure, `2` usage error.
- Commands:
  - `emos doctor` prints a checklist, one `✓`/`✗` per line, of: data dir, not-in-checkout, service reachable, API version, keychain readable. Later phases add lines for `claude` on PATH, Ollama and connectors.
  - `emos backup <dest>` calls a new op `backup.create` (add it to `api-contract/ops/backup.ts` and `service/handlers/backup.ts`), which uses `Db.backup`.
  - `emos service start|stop|status`.

- [ ] **Step 1: Write the failing tests.** Doctor against a running test service prints `✓ service reachable` and exits 0. With no service it prints `✗ service reachable` and exits 1. Backup writes a file that `openDb` can open.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use a minimal argv parser (no dependency).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p0-12): emos cli doctor, backup and service control`.

**Acceptance:** `emos doctor` is accurate in both the running and the stopped state. `emos backup` produces a restorable copy.

---

### Task P0-13: `@emos/extension` — activation, launcher/attach, RPC bridge, panels

**Files:**
- Create in `packages/extension/`:
  - `package.json` (contributes the commands `emos.openDashboard` / `emos.reconnect`, the view container `emos`, and the webview view `emos.sidebar`)
  - `src/extension.ts`, `src/launcher.ts`, `src/bridge.ts`, `src/panels/dashboard.ts`, `src/panels/sidebar.ts`, `src/html.ts`
- Test: `packages/extension/src/{launcher,bridge}.test.ts` (unit tests with the `vscode` API mocked)

**Interfaces:**
- Consumes: `createClient`, `httpTransport` and `ServerEvent` (P0-08); the runtime file layout (P0-11); the `RUNTIME` decision (P0-03).
- Implements the webview ↔ extension message protocol defined in `@emos/api-contract/bridge.ts` (P0-08). It's reproduced here for reference:
  ```ts
  type ToHost = { kind: "rpc"; reqId: string; op: string; input: unknown } | { kind: "ready" } | { kind: "command"; command: string; args?: unknown[] };
  type ToView = { kind: "rpc-result"; reqId: string; ok: true; result: unknown } | { kind: "rpc-result"; reqId: string; ok: false; error: { code: string; message: string } }
              | { kind: "event"; event: ServerEvent } | { kind: "connection"; state: "connecting" | "connected" | "unavailable" };
  ```
- Produces:
  - `launcher.ensureService(dataDir): Promise<{ baseUrl: string; token: string }>`. It reads `service.json` and pings `/health/ping`. If the service isn't reachable, it spawns the bundled service per `RUNTIME` (detached, `shell: false`) and polls for up to 10 s.
  - `bridge.attach(webview, client)`: proxies `rpc` messages, forwards SSE events, and sends `connection` state.
  - The webview never sees the token.

- [ ] **Step 1: Write the failing tests.**
  - `launcher` with a stale `service.json` (dead pid) spawns once.
  - Concurrent `ensureService` calls spawn only once (in-process mutex).
  - A 401 triggers one token re-read, then `unavailable`.
  - `bridge` maps an `ApiError` to `{ ok: false, error }`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `html.ts` builds the webview HTML with the CSP from Global Constraints, a per-load nonce, and the `@emos/webview` bundle URI. The dashboard opens with `retainContextWhenHidden: true`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p0-13): extension launcher, rpc bridge and panels`.

**Acceptance:** Running `EM OS: Open Dashboard` in a dev host starts the service if needed and shows the dashboard tab. Killing the service shows `unavailable`, and `EM OS: Reconnect` recovers.

---

### Task P0-14: `@emos/webview` — Preact shell, bridge client, widget grid, service-status widget

**Files:**
- Create in `packages/webview/src/`:
  - `main.tsx`, `bridge.ts`, `App.tsx`, `Sidebar.tsx`, `theme.css`;
  - `grid/WidgetGrid.tsx`, `widgets/registry.ts` *(append-only)*, `widgets/ServiceStatus.tsx`
- Test: `packages/webview/src/{bridge,App}.test.tsx` (Vitest + jsdom + `@testing-library/preact`)

**Interfaces:**
- Consumes: the `ToHost`/`ToView` protocol from `@emos/api-contract/bridge.ts`, plus `OpName`, `OpInput` and `OpOutput` (all P0-08).
- Produces:
  ```ts
  export function rpc<N extends OpName>(op: N, input: OpInput<N>): Promise<OpOutput<N>>;   // bridge.ts, via acquireVsCodeApi().postMessage
  export function onEvent(fn: (e: ServerEvent) => void): () => void;
  export function useConnection(): "connecting" | "connected" | "unavailable";
  export interface WidgetDefinition { id: string; title: string; defaultSize: { w: 1 | 2 | 3 | 4; h: 1 | 2 | 3 }; Component: (p: { size: { w: number; h: number } }) => JSX.Element }
  export const widgets: WidgetDefinition[];   // registry.ts
  ```
- `App` renders `WidgetGrid`, a 4-column CSS grid with the default layout taken from registry order. Layout persistence comes in P1. The Phase 0 grid contains `ServiceStatus`, which calls `health.get` and shows the API version, uptime and connector states.
- The bundle has two entry points: `dashboard` (`App`) and `sidebar` (`Sidebar`).
- Colours come only from `var(--vscode-*)` CSS variables.

- [ ] **Step 1: Write the failing tests.**
  - `rpc` resolves when a matching `rpc-result` arrives, and rejects on `ok: false`.
  - `App` renders `Service unavailable` with a `Retry` button when the connection is `unavailable`.
  - `ServiceStatus` renders `API v1`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** esbuild bundles to `packages/webview/dist/{dashboard,sidebar}.js`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p0-14): webview shell, rpc bridge and service status widget`.

**Acceptance:** In the dev host, the dashboard tab shows the ServiceStatus widget with live data in both light and dark themes.

---

### Task P0-15: VSIX packaging + extension smoke test in CI

**Files:**
- Create:
  - `packages/extension/scripts/package.mjs` (bundles the extension, webview and service per `RUNTIME`);
  - `packages/extension/.vscodeignore`;
  - `test/smoke/{runTest.ts,suite/index.ts,suite/dashboard.test.ts}`
- Modify: `.github/workflows/ci.yml` (add a `smoke` job to the OS matrix, and upload the VSIX artifact on `main`)

**Interfaces:**
- Consumes: P0-13 and P0-14 outputs.
- Produces: `npm run package` → `packages/extension/em-os-<version>.vsix`, and `npm run smoke`.

- [ ] **Step 1: Write the failing smoke test.** Run `@vscode/test-electron` with a temp `EMOS_DATA_DIR`. Execute `emos.openDashboard`, then assert:
  - the service's `service.json` appears within 15 s;
  - `health.get` via the token returns `apiVersion: 1`;
  - the dashboard panel is visible.
- [ ] **Step 2: Run `npm run smoke`.** Expected: FAIL (no packaging yet).
- [ ] **Step 3: Implement the packaging.** Use `vsce package --no-dependencies` after the esbuild bundles. The service bundle goes in `dist/service/`.
- [ ] **Step 4: Run locally and in CI on both OSes.** Expected: PASS.
- [ ] **Step 5: Commit** `ci(p0-15): package vsix and run extension smoke on both os`.

**Acceptance (the Phase 0 done criterion):**
- CI produces a VSIX.
- Installed into a clean VS Code profile on macOS, it opens a dashboard tab that renders data served by the service.
- The smoke test is green on Windows x64.
- All spike decisions are recorded.
