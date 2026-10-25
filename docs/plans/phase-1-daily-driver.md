# Phase 1: Daily Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Team protocol: [README.md](README.md).

**Status:** in progress. Start with **P1-00**. Tasks that need a real transport (P1-13, P1-14) build against fixtures until owner spike P0-04 is recorded in ADR 0005.

**Goal:** The user plans every morning in EM OS. After a one-time import of their notes and a live calendar sync, the dashboard shows:

- the week's load;
- today's timeline with focus blocks;
- "do these 5" with reasons;
- waiting-on items;
- meeting prep.

Commitments, person notes, goals and meeting notes can be captured by hand. Claude Code can query it all over MCP.

**Architecture:**

- Vertical slices: each slice adds a repo (`store-sqlite`), use cases (`core`), ops (`api-contract`) and handlers (`service`).
- Ranking, planning, week load and prep are pure `core` functions.
- Connectors run in the service behind a capability-based runtime.
- The VS Code extension adds commands and webview views over the same API.

**Tech Stack:** As Phase 0, plus `@modelcontextprotocol/sdk` (MCP client + server), `ical.js` (ICS parsing / RRULE expansion) and `yaml`.

**Spec:** [`docs/PRODUCT_SPEC.md`](../PRODUCT_SPEC.md) §§5.1–5.2, 5.5–5.7, 5.9, 7.1, 7.5, 7.6 (fields only), 10, 11, 12 (Phase 1 row). ADRs 0001, 0004, 0005, 0008, 0010, 0011, 0012, 0013. Import format: [`docs/importers/em-template.md`](../importers/em-template.md).

**Requires:** every Phase 0 task done. Its Interfaces blocks are the starting contract: `ops`, `defineOp`, `Handler`, `ServiceContext`, `Db`, the `Store` port, `rpc()`, `widgets` and the bridge protocol.

## Commitment-first validation milestones (owner priority, 2026-10-24)

These are **intermediate dogfooding milestones**, not a replacement for the Phase 1 daily-driver scope. Preserve the existing task IDs, contracts, hard rules, and accepted ADRs. P1-00 hardening remains the first task. This plan change does not authorize agents to alter accepted interfaces or skip dependencies.

**Alpha A — manual commitment loop.** After P1-00, prioritize P1-02, P1-05, P1-01, P1-03 and the new P1-44. P1-44 provides a small commitment-first VS Code surface using the existing API, independent of P1-10, P1-23 and the calendar. The owner can capture a commitment, inspect provenance/audit history, list `mine` and `owed_to_me`, edit due dates, snooze, complete, drop and reopen, and return the next morning. Use synthetic data first; use permitted work data only on the owner's machine. **Exit:** five consecutive workdays of use; record capture time, friction, missing follow-up semantics and failures. P1-28 remains the full person/goals/commitment view and must reuse, not duplicate, P1-44's UI primitives.

**Alpha B — assisted capture, narrow experiment.** After the manual loop, P1-46 tests pasted synthetic meeting excerpts and optional owner-approved real excerpts, with no connector dependency. The model outputs proposals with *source spans* and confidence; nothing becomes active without triage. This is a throwaway spike and does not implement the production `commitment.extract` pipeline. Evaluate false positives, missed explicit promises, duplicates, and false-done suggestions. Record findings and any proposed design changes for owner review; do not silently change ADR 0007.

**Follow-up semantics gate.** P1-45 tests the existing commitment state machine and audit trail against reminders, partial fulfilment, changed deadlines, undated triggers, and repeated follow-ups. Where audit events cannot represent meaningful user-facing history, propose a separate interaction/event model and the necessary spec/ADR change *before* implementing it. Do not confuse an operational audit log with a history of conversations or reminders.

**Suggested evaluation measures (provisional, not achieved):** manual capture under 10 seconds; proposal triage under 8 seconds; accepted-suggestion precision ≥90%; explicit-commitment recall ≥80% on a labelled set; duplicate proposal rate <5%; daily use ≥4 workdays/week. Track recovered forgotten commitments and false completion suggestions separately. Acceptance rate ≥70% remains a product metric, but is not a substitute for independently labelled precision/recall.

**Execution order:** P1-00 first. Then run the independent foundational lanes allowed by the task board. Prioritize the commitment vertical slice and P1-44 before calendar-dependent dashboard widgets. P1-45 follows P1-02; P1-46 follows P1-04 and P1-02. The owner reviews Alpha A and Alpha B before broadening automation. Remaining Phase 1 tasks and P1-33 still apply.

## Global Constraints

Everything in Phase 0's Global Constraints applies, plus:

- **Ranking** is deterministic and explainable. No model call in ranking, planning, week load or prep (ADR 0008).
- **Machine-made commitments** are never auto-activated. Imported and MCP-proposed items land as `status: "proposed"` (notes: `reviewState: "proposed"`) until the proposals review keeps them (ADR 0011, ADR 0013).
- **Other attendees' action items** stay on the meeting (`meeting.actionItems`). They're never put on the user's list.
- **Pronouns:** null means unknown. UI shows "pronouns: unknown, using they/them". Generated text never infers pronouns from a name.
- **Sensitivity defaults:**
  - person notes → `people_sensitive`;
  - notes pasted into a `one_on_one` meeting → `people_sensitive`;
  - everything else → `normal`.

  `private` is never returned by MCP.
- **The calendar connector only reads.** The planner never edits the calendar.
- **Default settings** (overridable):

  | Setting | Default |
  |---|---|
  | Work week | Mon–Fri |
  | Working hours | 09:00–17:00 in the display time zone |
  | Min focus block | 15 min |
  | Default effort | 30 min |
  | Top N | 5 |
  | Goal slots | 1 |
  | Decay | 14 days |
  | Calendar sync window | now−7d … now+14d |
  | Calendar sync interval | every 15 min while the service runs |

- **Performance:** `today.get` responds in < 500 ms on the synthetic import fixture plus 200 meetings.

## Review Focus

1. **A meeting that crosses DST**, or a calendar event zone that differs from the display zone, e.g. a 9am America/New_York meeting viewed in America/Los_Angeles. Expected: it lands at 6am on the timeline and in that local day's week-load bar. Pinned in P1-07 (`plan.test.ts › meeting in other zone`) and P1-08 (`weekLoad.test.ts › dst week`).
2. **Drifting markdown**:
   - CRLF line endings;
   - missing sections;
   - duplicate id markers on one line;
   - Unicode names (`Zoë Quinn`);
   - a person present in both People and Stakeholders.

   Expected: the import completes, the report lists unparseable lines with file:line, and no person is duplicated. Pinned in P1-16 (fixture) and P1-17 / P1-18 tests.
3. **Empty state** (first run before onboarding, no meetings, no commitments). Expected: the dashboard renders an empty state with "Run setup" or "Add your first item", with no errors. Pinned in P1-10 (`today.test.ts › empty store`) and P1-23 (`Header.test.tsx › empty`).
4. **Ambiguous person names** (two people match `@sam`, or `get_person("Sam")`). Expected: quick capture asks the user to pick, and MCP returns a candidate list instead of guessing. Pinned in P1-03 and P1-15.
5. **Completing an item mid-day.** Expected: the top 5 stays stable for the day, with the done item struck through and the progress ring advancing. It's not replaced silently; it's only refreshed on explicit "Refresh plan". Pinned in P1-10 (`today.test.ts › day plan is stable`).
6. **Person-note MCP filtering (security finding L5, P1-47).** A note mix of every sensitivity level × retention state, queried with `allowSensitive` true/false and with/without an explicit person target, must yield exactly the allowed set over MCP while the repository still returns all of them. Pinned in P1-15 (`policy.test.ts`, the MCP `people.test.ts` cases and the repo/service boundary guards).

---

## Task board

**Phase 0 carry-over (do first)**

- [x] **P1-00** Phase 0 hardening: host-only ops in the webview bridge, a case-insensitive data-dir gate, a shutdown pid guard — deps: Phase 0 — claim: done · b64c05f

**Slices (data + ops)**

- [x] **P1-01** People, identities and person notes slice — deps: P1-05 — claim: done · 865b585
- [x] **P1-47** P1-01-H people slice security hardening — deps: P1-01 — claim: done · 9d05c2c
- [x] **P1-02** Commitments (incl. recurrence) + goals + accomplishments slice — deps: Phase 0 — claim: done · b968a63
- [ ] **P1-03** Quick-capture parser + `commitments.quickCapture` — deps: P1-01, P1-02, P1-05 — claim: coder · p1-03-quick-capture
- [ ] **P1-04** Meetings + source items slice (incl. paste notes) — deps: Phase 0 — claim: —
- [x] **P1-05** Settings, profile and layout slice — deps: Phase 0 — claim: done · e7aa721

**Core logic (pure)**

- [ ] **P1-06** Ranking engine `rank` + `selectTop` — deps: P1-05 — claim: —
- [ ] **P1-07** Planner `plan` (free blocks + placement) — deps: P1-06 — claim: —
- [ ] **P1-08** Week load `weekLoad` — deps: P1-07 — claim: —
- [ ] **P1-09** Meeting classification + `prep.get` — deps: P1-01, P1-02, P1-04, P1-05 — claim: —
- [ ] **P1-10** `today.get` aggregation + stable day plan — deps: P1-02, P1-04, P1-05, P1-06, P1-07, P1-08, P1-09, P1-12 — claim: —
- [ ] **P1-11** End-of-day wrap use case + ops — deps: P1-02, P1-10 — claim: —

**Connectors**

- [ ] **P1-12** Connector runtime, registry, scheduler, offline handling, fixture invoker — deps: Phase 0 — claim: —
- [ ] **P1-13** MCP direct transport + tool-mapping presets — deps: P1-12 — claim: —
- [ ] **P1-14** Calendar connector (MCP capability + ICS native) — deps: P1-01, P1-04, P1-09, P1-12, P1-13 — claim: —

**MCP server + Claude Code**

- [ ] **P1-15** EM OS MCP server (read tools, per-client tokens, stdio launcher) — deps: P1-01, P1-02, P1-04, P1-10 — claim: —
- [ ] **P1-38** MCP proposal + ingest tools, `proposals.*` ops — deps: P1-01, P1-02, P1-04, P1-15 — claim: —
- [ ] **P1-39** Claude Code skills pack (`/emos-update`, `/emos-prep`, `/emos-capture`) + installer — deps: P1-38 — claim: —

**Importer (ephemeral, `@emos/importer-em-template`)**

- [ ] **P1-16** Synthetic em-template fixture workspace (with pinned mtimes) — deps: Phase 0 — claim: —
- [ ] **P1-17** Importer framework + Markdown / todo-line parsers — deps: P1-16 — claim: —
- [ ] **P1-18** People + Stakeholders import — deps: P1-01, P1-17 — claim: —
- [ ] **P1-19** Meetings, notes and daily-log import — deps: P1-04, P1-09, P1-18 — claim: —
- [ ] **P1-21** Risks, decisions, goals, growth and reference import — deps: P1-02, P1-04, P1-17 — claim: —
- [ ] **P1-20** Todo import + activation rule — deps: P1-02, P1-18, P1-19, P1-21 — claim: —
- [ ] **P1-22** Dry-run report, apply, self person, `emos import`, import ops — deps: P1-18, P1-19, P1-20, P1-21 — claim: —

**UI (extension + webview)**

- [ ] **P1-23** Header strip + week-load widgets + layout editing + `useToday` — deps: P1-05, P1-10 — claim: —
- [ ] **P1-24** Today timeline widget — deps: P1-23 — claim: —
- [ ] **P1-25** Do-these-5 + waiting-on widgets — deps: P1-23 — claim: —
- [ ] **P1-26** Sidebar view — deps: P1-23 — claim: —
- [ ] **P1-40** People cadence widget — deps: P1-01, P1-04, P1-23 — claim: —
- [ ] **P1-28** Person page (minimal), goals and commitment views + `openView` router — deps: P1-01, P1-02, P1-04 — claim: —
- [ ] **P1-27** Commands: quick capture, note about person, refresh, sync — deps: P1-01, P1-03, P1-28 — claim: —
- [ ] **P1-43** "Go to…" quick pick + `search.quick` — deps: P1-01, P1-02, P1-04, P1-28 — claim: —
- [ ] **P1-29** Meeting prep panel + paste notes — deps: P1-04, P1-09, P1-28 — claim: —
- [ ] **P1-30** End-of-day wrap view — deps: P1-11, P1-28 — claim: —
- [ ] **P1-41** Notifications (meeting soon, morning digest, wrap nudge, connector trouble, quiet hours) — deps: P1-05, P1-10, P1-12, P1-28 — claim: —
- [ ] **P1-32** Proposals review screen (import + MCP proposals) — deps: P1-22, P1-28, P1-38 — claim: —
- [ ] **P1-31** Onboarding wizard + settings view — deps: P1-01, P1-05, P1-14, P1-15, P1-22, P1-34 — claim: —

**Discovery, trust and distribution**

- [ ] **P1-34** Tool discovery: server detection, catalog, read/write classification, capability matcher — deps: P1-13 — claim: —
- [ ] **P1-35** Plugin loader + aggregator adapter interface + synthetic reference adapter — deps: P1-34 — claim: —
- [ ] **P1-36** Trust and exit: health panel, open data folder, export, delete all data — deps: P1-05, P1-12, P1-15 — claim: —
- [ ] **P1-42** Automatic daily backups with rotation — deps: Phase 0 — claim: —
- [ ] **P1-37** *manual + CI* Marketplace and Open VSX publishing — deps: P0-15, P1-36 — claim: owner (steps 1 and 4); an agent may do steps 2, 3 and 5

**Commitment-first validation (new intermediate milestones)**

- [ ] **P1-44** Minimal commitment loop UI + dogfood checklist — deps: P1-01, P1-02, P1-03, P1-05 — claim: —
- [ ] **P1-45** Follow-up semantics tests and model review — deps: P1-02 — claim: coder · p1-45-follow-up-semantics
- [ ] **P1-46** *spike* Pasted-text commitment extraction evaluation — deps: P1-02, P1-04 — claim: —

**Close-out**

- [ ] **P1-33** Phase 1 end-to-end synthetic test + owner dogfood checklist — deps: every P1 task except P1-37 — claim: —

Starting lanes (no Phase 1 dependencies): P1-02, P1-04, P1-05, P1-12, P1-16 and P1-42. UI tasks can build against a fake `rpc()` as soon as their ops exist in `api-contract`.

---

### Task P1-00: Phase 0 hardening (from the Phase 0 final review)

**Files:**
- `packages/extension/src/bridge.ts` (+ test)
- `packages/service/src/secrets.ts` (+ test)
- `packages/service/src/handlers/service.ts`
- `packages/service/src/server.ts`
- `packages/extension/src/launcher.ts` (+ tests)
- `packages/api-contract/src/entities/common.ts` (+ test)
- `packages/service/src/lockfile.ts` (+ test)
- `packages/store-sqlite/src/fts5.test.ts`
- `.github/workflows/ci.yml`
- `docs/adr/0001-backend-service-and-clients.md` and `docs/adr/0002-local-sqlite-store.md` (dated Verification updates only)

**Changes:**

- [x] **Host-only ops.** Add `HOST_ONLY_OPS = new Set(["service.shutdown", "backup.create"])` to the extension bridge. `isKnownOp` accepts an op only when `Object.hasOwn(ops, op)` and the op is not in that set. A test asserts the webview gets `not_found` for both ops.
- [x] **Memory secret-store gate.** `real()` must use `realpathSync.native`. On `darwin` and `win32`, compare the chosen data dir against the platform default case-insensitively, so a case variant of the default selects the keychain. Add a case-variant test.
- [x] **Shutdown guard.** `service.shutdown` gets an optional `{ pid }` input and is refused unless `pid === process.pid`. The launcher sends the pid it read from `service.json`.
- [x] **Shutdown trigger.** Trigger shutdown on the response's `close` event, not `finish`.
- [x] **Lock release.** In the launcher, `lockReleased` treats a lock that names a different pid as released, so it never kills a pid that has already exited.
- [x] **`isRealDate`.** Use `setUTCFullYear(y, m - 1, d)` so years 0000–0099 are handled correctly. A test covers `0000-02-29`.
- [x] **Lock staleness.** Add a 120 s margin to the boot-time check, and store `uptimeAtStart` in the lock JSON. Treat `os.uptime() < uptimeAtStart` as proof of a reboot.
- [x] **FTS5 check.** Add a store-sqlite test that creates an FTS5 virtual table, inserts rows and runs a `MATCH` query, so FTS5 availability is proven on every CI OS. This closes the ADR 0002 Verification item.
- [x] **Windows keychain in CI.** Enable `EMOS_TEST_KEYCHAIN=1` on the `windows-latest` test job. If Credential Manager isn't usable on the runner, record that in ADR 0001 Verification and keep it macOS-only. This closes, or documents, the ADR 0001 checklist item 2.

**Acceptance:** each change has a test, `npm run ci` passes, and the smoke test passes.

---

## Slice conventions (apply to P1-01 … P1-05, P1-09 … P1-11)

Each slice owns:

- `packages/core/src/<area>/` — use cases + types;
- `packages/core/src/ports/repos/<area>.ts` — repo interface. Add one field to `Store` in `ports/store.ts` *(append-only)*;
- `packages/store-sqlite/src/repos/<area>.ts` — implementation, registered in `store-sqlite/src/store.ts` *(append-only)*;
- `packages/api-contract/src/ops/<area>.ts`, registered in `ops/index.ts` *(append-only)*;
- `packages/service/src/handlers/<area>.ts`, registered in `handlers/index.ts` *(append-only)*.

Every mutation:

- updates `updatedAt`;
- publishes `items.changed { entity, ids }`;
- runs inside `store.transaction`.

Repo methods are synchronous. Handlers validate foreign ids and throw `ApiError("not_found")` for unknown ones. Tests:

- repo tests use a temp DB via `openDb`;
- handler tests use `startService` on a temp data dir and the typed client.

---

### Task P1-01: People, identities and person notes slice

**Files:** `core/src/people/{resolve.ts,index.ts}`, `core/src/ports/repos/people.ts`, `store-sqlite/src/repos/people.ts`, `api-contract/src/ops/people.ts`, `service/src/handlers/people.ts` (plus tests beside each).

**Interfaces:**
- Produces:
  ```ts
  interface PeopleRepo {
    create(p: NewPerson): Person; update(id: string, patch: Partial<NewPerson>): Person; get(id: string): Person | null;
    list(f?: { relationship?: Relationship[]; includeArchived?: boolean }): Person[];
    addIdentity(i: NewIdentity): Identity; identities(personId: string): Identity[];
    findIdentity(source: string, handle: string): Identity | null;          // handle compared case-insensitively
    addNote(n: NewPersonNote): PersonNote; notes(personId: string, range?: { from?: IsoDateTime; to?: IsoDateTime }): PersonNote[];
  }
  // core/src/people/resolve.ts
  export function resolvePerson(query: string, people: Person[], identities: Identity[]): Person[]; // exact displayName/alias/handle (case- and accent-insensitive) first; then first-name prefix; [] if none
  ```
- Ops (input → output):
  - `people.list {relationship?, includeArchived?} → Person[]`
  - `people.get {id} → { person, identities, notes: PersonNote[] }`
  - `people.create NewPerson → Person`
  - `people.update {id, patch} → Person`
  - `people.addIdentity NewIdentity → Identity`
  - `people.resolve {query} → Person[]`
  - `personNotes.create { personId, text, date?: LocalDate, tags?: string[], sensitivity?, sourceUrl?: string } → PersonNote`
  - `personNotes.list { personId, from?, to? } → PersonNote[]`

  For notes, `occurredAt` is the start of `date` in the display time zone (default today), and `origin` is `"manual"`.

- [x] **Step 1: Write the failing tests.**
  - `resolvePerson("zoe", …)` matches `Zoë Quinn`.
  - `resolvePerson("sam", …)` returns both Sams.
  - `findIdentity("chat","@ALEX")` matches `@alex`.
  - A note defaults to `people_sensitive` and today's date.
  - A backdated note `date: "2026-09-01"` sorts before today's.
  - `people.get` for an unknown id → `not_found`.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement.** Use NFD normalisation with diacritics stripped for matching.
- [x] **Step 4: Run.** Expected: PASS.
- [x] **Step 5: Commit** `feat(p1-01): people, identities and person notes`.

**Acceptance:** People and notes can be created, listed and resolved through the API. Ambiguous names return all candidates.

---

### Task P1-47: P1-01-H people slice security hardening

**Files:** `core/src/people/{resolve.ts,index.ts}`, `core/src/ports/repos/people.ts`, `store-sqlite/src/repos/people.ts`, `api-contract/src/ops/people.ts`, `service/src/handlers/people.ts` (plus tests beside each).

- [x] Bound relationship filters, aliases, note text and tags.
- [x] Accept only bounded HTTP(S) note source URLs.
- [x] Return `conflict` for duplicate identity handles and a second self person.
- [x] Record the MCP sensitivity/retention filtering requirement as follow-up work, without filtering the repository.
- [x] Run `npm run ci`.

**Acceptance:** Oversized people inputs fail validation, unsafe source URL schemes are rejected, uniqueness conflicts return HTTP 409, and the future MCP person surface owns sensitivity/retention filtering.

---

### Task P1-02: Commitments + goals slice

**Files:** `core/src/commitments/{transitions.ts,recurrence.ts,index.ts}`, `core/src/goals/index.ts`, `core/src/ports/repos/{commitments,goals,accomplishments}.ts`, `store-sqlite/src/repos/{commitments,goals,accomplishments}.ts`, `api-contract/src/ops/{commitments,goals}.ts`, `service/src/handlers/{commitments,goals}.ts`.

**Interfaces:**
- Produces:
  ```ts
  type CommitmentAction = "activate" | "complete" | "snooze" | "drop" | "reopen" | "edit" | "pin" | "unpin";
  export function transition(c: Commitment, action: CommitmentAction, at: Date, args?: { until?: IsoDateTime; reason?: DropReason }): Commitment; // throws ApiError("conflict") on illegal moves
  interface CommitmentsRepo {
    create(c: NewCommitment, sourceIds?: string[]): Commitment; save(c: Commitment, audit: { action: CommitmentAction; actor: "user" | "import" | "system"; note?: string }): Commitment;
    get(id: string): Commitment | null; audit(id: string): AuditEvent[];
    list(f: { status?: CommitmentStatus[]; direction?: Direction; counterpartId?: string; meetingId?: string; goalId?: string; createdBy?: CreatedBy[]; dueOnOrBefore?: LocalDate }): Commitment[];
  }
  interface GoalsRepo { create(g: NewGoal): Goal; update(id: string, patch: Partial<NewGoal>): Goal; get(id: string): Goal | null; list(f?: { status?: GoalStatus[]; subjectPersonId?: string }): Goal[] }
  ```
- Legal transitions:

  | From | Allowed |
  |---|---|
  | `proposed` | `activate`, `drop` |
  | `active` | `complete`, `snooze`, `drop`, `edit`, `pin`, `unpin` |
  | `snoozed` | `activate` (also implicit once `snoozedUntil` passes), `complete`, `drop`, `edit` |
  | `done` / `dropped` | `reopen` (user only) |

- **Clearing `drop_reason`:** restoring or reopening a dropped commitment must clear `drop_reason` (set it to NULL) in the same UPDATE that changes the status. The `commitments` table CHECK (P0-10) only allows a non-null `drop_reason` while `status = 'dropped'`, so a separate UPDATE fails.

- Ops: `commitments.list | get | create | update | complete | snooze {id, until} | drop {id, reason} | reopen | pin {id, pinned}`, and `goals.list | create | update`.
- `commitments.get {id} → { commitment, sources: SourceItem[], audit: AuditEvent[] }`. Audit rows live in `audit_events` (P0-10).
- **Recurrence:** `export function nextOccurrence(r: Recurrence, after: LocalDate): LocalDate` in `core/src/commitments/recurrence.ts`. Completing a commitment that has a `recurrence` also creates the next occurrence in the same transaction: same `seriesId`, `status: "active"`, and `due.date = nextOccurrence(recurrence, completed due date or today)`.
- **Accomplishments repo** (owned here; P1-11 and P1-21 consume it): `interface AccomplishmentsRepo { create(a: NewAccomplishment, sourceIds?: string[]): Accomplishment; list(f?: { subjectPersonId?: string; from?: IsoDateTime; to?: IsoDateTime }): Accomplishment[] }`. Source links go in `record_sources`.

- [x] **Step 1: Write the failing tests.**
  - `complete` sets `completedAt` and `status: "done"`.
  - `complete` on a `dropped` item throws `conflict`.
  - `reopen` by `actor: "system"` throws.
  - Each save appends one audit row.
  - `list({ status: ["active"], direction: "owed_to_me" })` filters correctly.
  - The `snooze` op stores `snoozedUntil`.
  - `edit` on a snoozed item is allowed.
  - `nextOccurrence({freq:"weekly",interval:1,byWeekday:[5],byMonthDay:null}, "2026-10-23")` → `"2026-10-30"`.
  - Monthly on day 31 after `"2026-01-31"` → `"2026-02-28"`.
  - Completing a weekly item creates one new active item with the same `seriesId`.
  - `commitments.get` returns sources and audit.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expected: PASS.
- [x] **Step 5: Commit** `feat(p1-02): commitments and goals with audited transitions`.

**Acceptance:** Every transition is audited. A re-run import or sync can never move a `done` or `dropped` item back to active, because only `reopen` by `actor: "user"` can.

---

### Task P1-03: Quick-capture parser + `commitments.quickCapture`

**Files:** `core/src/commitments/quick-capture.ts`, `api-contract/src/ops/quick-capture.ts`, `service/src/handlers/quick-capture.ts`.

**Interfaces:**
- Consumes: `resolvePerson` (P1-01), `CommitmentsRepo` (P1-02), `toLocalDate` / `addLocalDays` (P0-09).
- Produces:
  ```ts
  export interface ParsedCapture { title: string; direction: Direction; personQuery: string | null; due: { date: LocalDate; time: null; timeZone: string } | null; priority: 0|1|2|3|null; urgency: Urgency | null; tags: string[]; recurrence: Recurrence | null }
  export function parseQuickCapture(text: string, now: Date, timeZone: string): ParsedCapture | { error: "empty_title" };
  ```
- Grammar (tokens are whitespace-separated and may appear anywhere):
  - a leading `wait ` → `owed_to_me`; otherwise `mine`;
  - `@name` → `personQuery` (first one wins);
  - `!p0`…`!p3` → priority;
  - `!now | !next | !soon | !later | !someday` → urgency;
  - `!today | !tomorrow | !mon … !sun` → the next occurrence, *including today*;
  - `!YYYY-MM-DD`;
  - `!+Nd` → due;
  - `!every-day`, `!every-mon` … `!every-sun`, `!every-month` → `recurrence` (weekly items default their due date to the next such weekday; monthly items use the due day, or today);
  - `#tag` → tags;
  - the remaining words, single-spaced, form the title.
- Op: `commitments.quickCapture { text, counterpartId?: string } → { status: "created", commitment } | { status: "needs_person", parsed: ParsedCapture, candidates: Person[] } | { status: "invalid", message: string }`. A `personQuery` with zero matches → `needs_person` with empty candidates (the UI offers "create person"). If `profile.selfPersonId` is null → `{ status: "invalid", message: "Finish setup first" }`.

- [ ] **Step 1: Write the failing tests** (now `2026-10-20T16:00Z`, zone `America/Los_Angeles`, a Tuesday):
  ```ts
  expect(parseQuickCapture("Send hiring feedback @sam !fri !p1 #hiring", now, tz)).toEqual({ title: "Send hiring feedback", direction: "mine", personQuery: "sam", due: { date: "2026-10-23", time: null, timeZone: tz }, priority: 1, urgency: null, tags: ["hiring"] });
  expect(parseQuickCapture("wait @jordan API spec !thu", now, tz)).toMatchObject({ direction: "owed_to_me", title: "API spec", due: { date: "2026-10-22" } });
  expect(parseQuickCapture("x !tue", now, tz)).toMatchObject({ due: { date: "2026-10-20" } });
  expect(parseQuickCapture("x !+3d", now, tz)).toMatchObject({ due: { date: "2026-10-23" } });
  expect(parseQuickCapture("@sam !p1", now, tz)).toEqual({ error: "empty_title" });
  expect(parseQuickCapture("EOW update !every-fri", now, tz)).toMatchObject({ recurrence: { freq: "weekly", interval: 1, byWeekday: [5] }, due: { date: "2026-10-23" } });
  // op: two Sams → needs_person with 2 candidates; with counterpartId → created
  ```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-03): one-line quick capture`.

**Acceptance:** One line creates a fully-fielded active commitment. Ambiguity never silently picks a person.

---

### Task P1-04: Meetings + source items slice

**Files:** `core/src/meetings/index.ts`, `core/src/ports/repos/{meetings,source-items}.ts`, `store-sqlite/src/repos/{meetings,source-items}.ts`, `api-contract/src/ops/meetings.ts`, `service/src/handlers/meetings.ts`.

**Interfaces:**
- Produces:
  ```ts
  interface MeetingsRepo {
    upsertExternal(m: ExternalMeeting): { meeting: Meeting; created: boolean };   // key: (connectorId, externalId); keeps classification/personId when classificationSource === "user"
    get(id: string): Meeting | null; listRange(from: IsoDateTime, to: IsoDateTime, f?: { includeCancelled?: boolean; personId?: string; classification?: Classification }): Meeting[];
    update(id: string, patch: Partial<Pick<Meeting, "classification" | "personId" | "actionItems">>): Meeting;   // a user classification change sets classificationSource = "user"
    attachNote(meetingId: string, sourceItemId: string): void; notes(meetingId: string): SourceItem[];
    previousOf(meeting: Meeting, f: { classification?: Classification; personId?: string }): Meeting | null; // latest earlier meeting matching
  }
  interface SourceItemsRepo { upsert(i: NewSourceItem): { item: SourceItem; created: boolean }; get(id: string): SourceItem | null; byIds(ids: string[]): SourceItem[] }
  ```
- Ops:
  - `meetings.list {from, to, personId?, classification?} → Meeting[]`
  - `meetings.get {id} → { meeting, notes: SourceItem[] }`
  - `meetings.update {id, patch} → Meeting`
  - `meetings.attachNotes { meetingId, text, kind: "summary" | "transcript" } → SourceItem` — a `kind` of `note` or `transcript`, `origin: "manual"`, `occurredAt` = meeting start. Sensitivity is `people_sensitive` when the meeting is `one_on_one`, else `normal`.

- [ ] **Step 1: Write the failing tests.**
  - Upserting the same external id twice → one row, with `created` false the second time.
  - A user-set classification survives a re-upsert.
  - `attachNotes` on a 1:1 → `people_sensitive`.
  - `listRange` excludes cancelled meetings by default.
  - `previousOf` finds the last standup.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-04): meetings and source items with pasted notes`.

**Acceptance:** Notes can be pasted onto any meeting and are stored dated and with the right sensitivity.

---

### Task P1-05: Settings, profile and layout slice

**Files:** `api-contract/src/entities/settings.ts`, `core/src/settings/defaults.ts`, `core/src/ports/repos/settings.ts`, `store-sqlite/src/repos/settings.ts`, `api-contract/src/ops/settings.ts`, `service/src/handlers/settings.ts`.

**Interfaces:**
- Produces:
  ```ts
  export const Profile = z.object({
    selfPersonId: z.string().nullable(), displayTimeZone: z.string(), workWeek: z.array(z.number().int().min(0).max(6)),
    workingHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }),
    meetingRules: z.array(z.object({ pattern: z.string(), classification: Classification })),
    rank: RankConfig, minFocusMinutes: z.number(), defaultEffortMinutes: z.number(), decayDays: z.number(), eodNudgeTime: z.string().nullable(), onboarded: z.boolean(),
  });
  export const RankConfig = z.object({ topN: z.number(), goalSlots: z.number(), timeCriticalHours: z.number(), weights: z.object({ timeCritical: z.number(), overduePerDay: z.number(), hardDated: z.number(), waitingPerDay: z.number(), goal: z.number(), pin: z.number(), priority: z.tuple([z.number(), z.number(), z.number(), z.number()]), urgencyNow: z.number() }) });
  // Profile also has notifications: { meetingLeadMinutes: 10, morningDigestTime: "08:45" | null, quietHours: { start: "19:00", end: "08:00" } | null, enabled: { meetingSoon: true, morningDigest: true, wrapNudge: true, connectorTrouble: true } }
  export const DEFAULT_PROFILE: Profile; // values from Global Constraints; displayTimeZone from Intl; topN 5, goalSlots 1, timeCriticalHours 24; rank weights: timeCritical 1000, overduePerDay 50, hardDated 400, waitingPerDay 30, goal 150, pin 300, priority [120,80,40,0], urgencyNow 100
  interface SettingsRepo { getProfile(): Profile; setProfile(p: Profile): void; getLayout(surface: "dashboard" | "sidebar"): LayoutEntry[] | null; setLayout(surface, l: LayoutEntry[]): void }
  type LayoutEntry = { widgetId: string; w: number; h: number };
  ```
- Ops: `settings.get → Profile`, `settings.update {patch} → Profile` (deep-merged and re-validated), `layout.get {surface}`, `layout.set {surface, layout}`.

- [x] **Step 1: Write the failing tests.**
  - A fresh store returns `DEFAULT_PROFILE` with `onboarded: false`.
  - A patch to `workingHours.start` keeps the other fields.
  - An invalid time zone `"Mars/Base"` → `invalid_input` (validated via `Intl.supportedValuesOf("timeZone")`).
  - A layout round-trips.
- [x] **Step 2: Run.** Expected: FAIL.
- [x] **Step 3: Implement.**
- [x] **Step 4: Run.** Expected: PASS.
- [x] **Step 5: Commit** `feat(p1-05): profile, rank config and layouts`.

**Acceptance:** All configurable defaults live in one validated profile.

---

### Task P1-06: Ranking engine

**Files:** `core/src/ranking/{rank.ts,why.ts,select.ts,index.ts}` + tests.

**Interfaces:**
- Consumes: `RankConfig` (P1-05), entities (P0-08), time utils (P0-09).
- Produces:
  ```ts
  type ComponentKind = "time_critical" | "hard_dated" | "waiting_on_me" | "goal" | "pin" | "priority" | "urgency";
  export interface RankedItem { commitmentId: string; score: number; dominant: ComponentKind; why: string; components: { kind: ComponentKind; points: number; detail: string }[] }
  export function rank(input: { now: Date; timeZone: string; commitments: Commitment[]; meetings: Meeting[]; goals: Goal[]; config: RankConfig }): RankedItem[];
  export function selectTop(ranked: RankedItem[], commitments: Map<string, Commitment>, config: RankConfig): RankedItem[];
  ```
- **Candidates** are `direction: "mine"` commitments that are `status: "active"`, or `snoozed` with `snoozedUntil ≤ now`.
- **Components:**
  - **time_critical:** the linked meeting (`meetingId`) starts within `timeCriticalHours`, *or* the due date is ≤ tomorrow (local). Overdue adds `overduePerDay × days`.
  - **hard_dated:** due later than tomorrow, scaled `hardDated / daysUntilDue`.
  - **waiting_on_me:** `counterpartId` is set and there's no due date; `waitingPerDay × ageDays`, where age is measured from `occurredAt`.
  - **goal:** `goalId` is set and the goal is active.
  - **pin**, **priority** (weights by p0..p3) and **urgency** (`now` only).
- **Exclusions:** urgency `later` / `someday` items with no due date are excluded from `selectTop`, but still ranked.
- **Order:** by score descending; ties by due date (null last), then `capturedAt`.
- **Why chips** come from the dominant component (exact copy):

  | Condition | Chip |
  |---|---|
  | Linked meeting | `meeting 1pm` (`h` + `am`/`pm`, minutes only if non-zero, e.g. `meeting 9:30am`) |
  | Due today / tomorrow / overdue | `due today` / `due tomorrow` / `overdue 2d` |
  | Hard-dated | `due Mon` (≤ 6 days) or `due Oct 30` |
  | Waiting on me | `waiting on you 4d` |
  | Goal | `advances <goal title truncated to 20 chars + "…">` |
  | Pin / priority / urgency | `pinned` / `p0` / `now` |

- **`selectTop`:** takes `topN` items. If none of them is goal-linked and one exists further down, the last slot is replaced by the best goal-linked item (`goalSlots` times).

- [ ] **Step 1: Write the failing tests.**
  - Prep for a 1pm meeting today outranks an item due in 3 days.
  - Due today outranks due in 3 days.
  - Overdue 2d outranks due today.
  - `waiting on you 4d` outranks an undated p2.
  - A goal slot replaces the 5th item when no goal item is in the top 5.
  - Snoozed until tomorrow is excluded; snoozed until yesterday is included.
  - `someday` and undated is not in `selectTop`.
  - `owed_to_me` is never ranked.
  - The tie-break is deterministic (the same input in shuffled order gives an identical output).
  - Each why string matches exactly, including `meeting 9:30am`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-06): deterministic explainable ranking`.

**Acceptance:** It's a pure function, every ordering rule from spec §7.5 has a test, and every item has an exact why chip.

---

### Task P1-07: Planner

**Files:** `core/src/planning/{free-blocks.ts,plan.ts,index.ts}` + tests.

**Interfaces:**
- Consumes: `RankedItem` (P1-06), time utils (P0-09).
- Produces:
  ```ts
  export interface Block { start: IsoDateTime; end: IsoDateTime; minutes: number }
  export interface DayPlan { freeBlocks: Block[]; placements: { commitmentId: string; blockIndex: number; start: IsoDateTime; end: IsoDateTime }[]; unplaced: string[] }
  export function freeBlocks(i: { localDate: LocalDate; timeZone: string; workingHours: { start: string; end: string }; meetings: Meeting[]; now: Date; minMinutes: number }): Block[];
  export function plan(i: { blocks: Block[]; items: RankedItem[]; effortOf: (commitmentId: string) => number }): DayPlan;
  ```
- **Busy time:** meetings where `selfResponse !== "declined"`, `status === "confirmed"` and `allDay === false`. Overlapping meetings are merged.
- **Free time:** working hours minus busy time. For today, clip to `now`. Drop blocks shorter than `minMinutes`.
- **Placement:** greedy in rank order, into the earliest block with enough remaining minutes. Items that don't fit go to `unplaced`.

- [ ] **Step 1: Write the failing tests.**
  - Meetings 9:00–9:15 and 10:30–11:00 with hours 09–17 → free blocks 9:15–10:30 and 11:00–17:00.
  - A 10-minute gap is dropped.
  - A declined meeting doesn't block time.
  - At `now` = 14:20, today's blocks start at 14:20.
  - **Meeting in another zone:** a meeting at 09:00 America/New_York on a America/Los_Angeles day is busy from 06:00, outside working hours, so it consumes nothing.
  - DST day `2026-11-01` in America/Los_Angeles has a correct 8-hour window.
  - A 90-minute item skips a 75-minute block.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-07): calendar-fit day planner`.

**Acceptance:** It's pure and handles time zones and DST, and items are placed only into real free time.

---

### Task P1-08: Week load

**Files:** `core/src/planning/week-load.ts` + test.

**Interfaces:**
- Produces:
  ```ts
  export interface DayLoad { date: LocalDate; meetingMinutes: number; workingMinutes: number; loadRatio: number; overloaded: boolean; due: { commitmentId: string; title: string }[] }
  export function weekLoad(i: { weekOf: LocalDate; workWeek: number[]; timeZone: string; workingHours: { start: string; end: string }; meetings: Meeting[]; commitments: Commitment[] }): DayLoad[];
  ```
- The week starts on the first `workWeek` day on or before `weekOf`, where `workWeek[0]` is the first day of the week. The result has one entry per `workWeek` day, in order.
- `meetingMinutes` counts the busy minutes inside working hours, using the same busy rule as P1-07.
- `overloaded` is `loadRatio ≥ 0.75`.
- `due` holds the active `mine` commitments due that day.

- [ ] **Step 1: Write the failing tests.**
  - 6h of meetings on Thu → `overloaded`.
  - A Sun–Thu `workWeek` (`[0,1,2,3,4]`) for `weekOf: "2026-11-03"` returns 5 entries starting Sunday `2026-11-01`. That's the US DST fall-back day, and a 09:00 meeting that day lands on `2026-11-01`.
  - A due item on Wed shows under Wed.
  - A Mon–Fri week of `2026-10-21` starts on `2026-10-19`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Reuse the busy-merging helper from `free-blocks.ts` (import it; don't copy it).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-08): week load`.

**Acceptance:** It's pure and DST-correct, and it uses the same busy rules as the planner.

---

### Task P1-09: Meeting classification + prep

**Files:** `core/src/meetings/{classify.ts,prep.ts}`, `api-contract/src/ops/prep.ts`, `service/src/handlers/prep.ts` + tests.

**Interfaces:**
- Consumes: repos from P1-01, P1-02 and P1-04; `Profile.meetingRules` (P1-05).
- Produces:
  ```ts
  export function classifyMeeting(m: Meeting, rules: Profile["meetingRules"], selfPersonId: string | null): { classification: Classification; personId: string | null };
  export interface MeetingPrep { meetingId: string; classification: Classification; status: "ready" | "needs_work" | "nothing_linked"; person: Person | null; openMine: Commitment[]; openTheirs: Commitment[]; linked: Commitment[]; lastNotes: { sourceItemId: string; occurredAt: IsoDateTime; excerpt: string } | null; carriedActionItems: Meeting["actionItems"] }
  export function buildPrep(i: { meeting: Meeting; person: Person | null; commitments: Commitment[]; previous: Meeting | null; previousNotes: SourceItem[] }): MeetingPrep;
  ```
- **Classification:**
  - The first matching rule wins (regex, case-insensitive, on the title).
  - Otherwise, exactly two attendees, self plus one known person → `one_on_one`, with `personId` set.
  - Otherwise, ≥ 3 attendees → `team`.
  - Otherwise → `other`.
  - A user-set classification is never overwritten (P1-04).
- **Prep:**
  - `openMine` / `openTheirs` are active commitments with that counterpart, `mine` and `owed_to_me` respectively.
  - `lastNotes` is the latest note of the previous 1:1 with that person; the excerpt is its first 280 chars.
  - `carriedActionItems` are the not-done `actionItems` of the previous standup (classification `standup`).
- **Status:**
  - `nothing_linked` if `linked` is empty;
  - `needs_work` if any linked commitment is active;
  - otherwise `ready`.
- Op: `prep.get {meetingId} → MeetingPrep`. `classifyMeeting` is applied by the calendar connector's applier (P1-14).

- [ ] **Step 1: Write the failing tests.**
  - Rule `^standup|stand-up` → `standup`.
  - Two attendees, one in the roster → `one_on_one` with that person's id.
  - A non-roster other attendee → `other`.
  - A linked active item → `needs_work`.
  - A linked done item → `ready`.
  - The previous standup's open action items are carried; done ones are not.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-09): meeting classification and minimal prep`.

**Acceptance:** 1:1 and standup prep can be served from the store.

---

### Task P1-10: `today.get` + stable day plan

**Files:** `core/src/today/{build.ts,index.ts}`, `core/src/ports/repos/day-plans.ts`, `store-sqlite/src/repos/day-plans.ts`, `api-contract/src/ops/today.ts`, `service/src/handlers/today.ts` + tests.

**Interfaces:**
- Consumes: `rank` / `selectTop` (P1-06), `freeBlocks` / `plan` (P1-07), `weekLoad` (P1-08), `buildPrep` (P1-09), and repos.
- Produces:
  - Ops:
    - `today.get { localDate?: LocalDate } → Today`
    - `today.refresh { localDate?: LocalDate } → Today` (re-selects the top list)
  - Types:
  ```ts
  export interface Today {
    localDate: LocalDate; timeZone: string; onboarded: boolean;
    header: { meetingCount: number; freeMinutes: number; toTriage: number; lastSyncAt: IsoDateTime | null; failingConnectors: string[] };
    weekLoad: DayLoad[];
    timeline: { meetings: { id: string; title: string; start: IsoDateTime; end: IsoDateTime; classification: Classification; prepStatus: MeetingPrep["status"] }[]; plan: DayPlan };
    top: { item: RankedItem | null; commitment: Commitment; done: boolean }[];   // done items keep their slot; item null when no longer ranked (done)
    waitingOn: Commitment[];                                                   // owed_to_me active, due asc (null last)
    progress: { done: number; total: number };
  }
  interface DayPlansRepo { get(localDate: LocalDate): string[] | null; set(localDate: LocalDate, ids: string[]): void }
  ```
- **Behaviour:**
  - On the first `today.get` for a date, store the `selectTop` ids in `day_plans`. Later calls reuse that list, marking items `done` when completed. New urgent items do *not* displace it, and only `today.refresh` re-selects.
  - `toTriage` is `0` in Phase 1: it counts proposed commitments with `createdBy` ≠ `import`.
  - `header.lastSyncAt` and `failingConnectors` come from `sync_state` (P1-12). `offline` connectors are listed with state `offline`, not as failures.

- [ ] **Step 1: Write the failing tests.**
  - **Empty store:** returns `onboarded: false`, empty arrays, `progress {0,0}`, and no throw.
  - **Day plan is stable:** after completing item 2 and adding a new due-today item, `top` ids are unchanged, item 2 is `done: true`, and progress is `{1,5}`. After `today.refresh`, the new item appears.
  - `waitingOn` is sorted by due date.
  - The header `freeMinutes` equals the sum of `plan.freeBlocks`.
  - A generated dataset (inside the test: 30 people, 500 commitments, 200 meetings) builds correctly. The timing check lives in a separate non-gating script, `npm run perf -w @emos/service`, which reports p50/p95 against the 500 ms budget.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-10): today aggregation with stable daily top list`.

**Acceptance:** One call gives every widget its data, and the daily list doesn't jump around.

---

### Task P1-11: End-of-day wrap

**Files:** `core/src/wrap/index.ts`, `api-contract/src/ops/wrap.ts`, `service/src/handlers/wrap.ts` + tests.

**Interfaces:**
- Produces:
  - `wrap.get { localDate? } → { items: { commitment: Commitment; inTodayPlan: boolean }[]; tomorrow: Today["timeline"]["meetings"] }`. Items are the day-plan items plus `mine` commitments updated today.
  - `wrap.apply { localDate?, decisions: { commitmentId: string; action: "done" | "tomorrow" | "redate" | "drop"; date?: LocalDate; remember?: boolean }[]; note?: string } → { applied: number }`:
    - `tomorrow` sets the due date to the next work day;
    - `redate` requires `date`;
    - `remember: true` on a `done` item creates an `Accomplishment { subject: self, summary: title, status: "accepted", sources: commitment sources }`;
    - `note` creates a `SourceItem { kind: "note", origin: "manual", occurredAt: now }`.
  - It uses `AccomplishmentsRepo` from P1-02. `tomorrow` and `redate` on a snoozed item use the `edit` transition.

- [ ] **Step 1: Write the failing tests.**
  - `tomorrow` on a Friday with a Mon–Fri week → Monday.
  - `redate` without a date → `invalid_input`.
  - `remember` creates one accomplishment.
  - Applying twice doesn't double-complete (idempotent per commitment status).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-11): end-of-day wrap`.

**Acceptance:** The wrap closes out the day in a single apply call and records accomplishments.

---

### Task P1-12: Connector runtime, orchestrator, scheduler

**Files:** `packages/connectors/src/runtime/{types.ts,orchestrator.ts,appliers.ts,scheduler.ts,fixture-invoker.ts,errors.ts,network.ts}`, `service/src/connectors/registry.ts` *(append-only: each connector task adds its definition)*, `service/src/main.ts` (start the scheduler after the service is listening), `core/src/ports/repos/sync-state.ts`, `store-sqlite/src/repos/sync-state.ts`, `api-contract/src/ops/connectors.ts`, `service/src/handlers/connectors.ts` + tests.

**Interfaces:**
- Produces:
  ```ts
  export type ConnectorKind = "chat" | "calendar" | "email" | "meeting_notes" | "code_host" | "tickets" | "docs" | "observability";
  export interface CapabilityInvoker { call<T>(capability: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> }
  export interface ConnectorContext<C> { config: C; caps: CapabilityInvoker; log: Logger; now(): Date }
  export type ConnectorItem = { entity: "meeting"; data: ExternalMeeting } | { entity: "source_item"; data: NewSourceItem };
  export interface SyncPage { items: ConnectorItem[]; nextCursor: string | null }
  export interface ConnectorDefinition<C> { id: string; kind: ConnectorKind; configSchema: z.ZodType<C>; requiredCapabilities: string[]; defaultIntervalMinutes: number;
    sync(ctx: ConnectorContext<C>, cursor: string | null, signal: AbortSignal): AsyncIterable<SyncPage> }
  export class ConnectorError extends Error { kind: "transient" | "offline" | "auth" | "permission" | "schema" | "config" }
  export function classifyNetworkError(e: unknown): "offline" | "transient" | null; // network.ts: ENOTFOUND, EAI_AGAIN, ECONNREFUSED, ENETUNREACH, EHOSTUNREACH, ETIMEDOUT, undici "fetch failed" → offline; 429/5xx → transient
  export async function runSync(deps: { store: Store; def: ConnectorDefinition<unknown>; ctx: ConnectorContext<unknown>; appliers: Appliers; events: EventBus; clock: Clock }): Promise<{ pages: number; items: number }>;
  export function fixtureInvoker(responses: Record<string, unknown[]>): CapabilityInvoker; // returns successive responses per capability
  ```
- **Orchestration:**
  - Each page's items plus `sync_state.cursor` are written in **one transaction**. A thrown applier rolls back the page and leaves the cursor unchanged.
  - Transient errors retry up to 3 times with exponential backoff (1 s, 4 s, 16 s, ±20 % jitter). `auth`, `permission`, `schema` and `config` errors never retry; they set `state: "error"`.
  - `sync_state` holds `{ connectorId, cursor, state: "never" | "syncing" | "ok" | "offline" | "error", lastAttemptAt, lastSuccessAt, lastError (message only), itemCount }`.
  - **Offline:** an `offline` error isn't retried within the run. It sets `state: "offline"` and `lastError: "Can't reach <server> — check your network or VPN"`. The next attempt happens at the next interval, or immediately on `connectors.sync`. Cached data stays usable.
  - The scheduler runs each enabled connector every `defaultIntervalMinutes` (overridable) and never runs one connector concurrently with itself.
- **Ops:**
  - `connectors.list → { id, kind, enabled, state, lastSuccessAt, lastError }[]`
  - `connectors.sync { id } → { pages, items }`
  - `connectors.configure { id, enabled, config }` — validated against `configSchema`; secret fields are stored via `SecretStore` and never echoed.
- Events: `sync.status`.

- [ ] **Step 1: Write the failing tests.**
  - Two pages apply and the cursor advances to the second page's.
  - An applier throw on page 2 keeps page 1 and leaves the cursor at page 1.
  - A transient error ×2 then success → success with 3 attempts.
  - An `auth` error → no retry, `state: "error"`.
  - A concurrent `connectors.sync` on the same id → the second call gets `conflict`.
  - `configure` with a secret doesn't return it in `connectors.list`.
  - An `ENOTFOUND` error → `state: "offline"` with the VPN hint, after 1 attempt.
  - A connector added to `service/src/connectors/registry.ts` appears in `connectors.list`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-12): connector runtime with transactional cursors`.

**Acceptance:** A connector can be added just by defining `sync`, and failures are isolated and visible.

---

### Task P1-13: MCP direct transport + tool-mapping presets

**Files:** `packages/connectors/src/mcp/{servers.ts,preset.ts,map.ts,invoker.ts}`, `packages/connectors/fixtures/presets/example-calendar.yaml` + tests.

**Interfaces:**
- Consumes: `CapabilityInvoker` and `ConnectorError` (P1-12); `SecretStore` (P0-09).
- Produces:
  ```ts
  export interface McpServerDef { name: string; type: "http" | "stdio"; url?: string; command?: string; args?: string[]; env?: Record<string, string>; auth?: { kind: "none" } | { kind: "bearer"; secretKey: string } | { kind: "oauth" } }
  export function loadServers(file: string): McpServerDef[];                 // Claude Code `{ mcpServers: {...} }` JSON shape
  export const Preset: z.ZodType<PresetDef>;                                   // YAML, see below
  export function applyResultMapping(raw: unknown, mapping: PresetDef["capabilities"][string]["result"]): { items: Record<string, unknown>[]; nextCursor: string | null };
  export function createMcpInvoker(server: McpServerDef, preset: PresetDef, secrets: SecretStore): CapabilityInvoker; // refuses capabilities not in preset
  ```
- Preset YAML (user presets live in `<dataDir>/config/presets/*.yaml`; the repo ships only the synthetic example):
  ```yaml
  preset: example-calendar
  server: example-server
  capabilities:
    calendar.listEvents:
      tool: list_events
      args: { start: "{{timeMin}}", end: "{{timeMax}}", page: "{{cursor}}" }
      result:
        items: "$.events[*]"
        nextCursor: "$.next"
        fields: { externalId: "id", title: "summary", start: "start.dateTime|start.date", end: "end.dateTime|end.date", attendees: "attendees", url: "htmlLink", status: "status", recurringEventId: "recurringEventId" }
  ```
- **Path syntax:** `$` root, `.key`, `[*]` (one level) and `|` fallbacks. An unresolved path → `null`.
- **Tool calls:** tool text content parsed as JSON. A non-JSON result → `ConnectorError("schema")`.
- **OAuth:** `{kind: "oauth"}` is implemented only if spike S2 recorded `mcp_direct: yes` for an OAuth server. Otherwise it throws `ConnectorError("config")` with message `"OAuth server: use the fallback recorded in ADR 0005"`.

- [ ] **Step 1: Write the failing tests.**
  - `applyResultMapping` resolves `start.dateTime|start.date` to the date for all-day events.
  - Unknown paths → null.
  - The invoker refuses `calendar.deleteEvent` (not in the preset).
  - Against an in-process MCP test server (`McpServer` + `InMemoryTransport`), `calendar.listEvents` returns mapped items and the next cursor.
  - Fixture presets pass `check-fixtures`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-13): mcp transport with declarative tool-mapping presets`.

**Acceptance:** Any MCP server can be bound to capabilities with YAML alone, and only mapped tools are callable.

---

### Task P1-14: Calendar connector

**Files:** `packages/connectors/src/calendar/{definition.ts,dto.ts,apply.ts,ics.ts}`, `packages/connectors/fixtures/calendar/{events.page1.json,events.page2.json,sample.ics}` + tests.

**Interfaces:**
- Consumes: P1-12 runtime and registry (append `calendarConnector`), the P1-13 invoker, `MeetingsRepo` (P1-04), `PeopleRepo.findIdentity` (P1-01), and `classifyMeeting` (P1-09), which the applier calls on every upsert unless `classificationSource === "user"`.
- Produces:
  ```ts
  export const CalendarEventDTO = z.object({ externalId: z.string(), title: z.string(), start: z.string(), end: z.string(), allDay: z.boolean(), status: z.enum(["confirmed", "cancelled", "tentative"]),
    attendees: z.array(z.object({ email: z.string().nullable(), displayName: z.string().nullable(), self: z.boolean(), responseStatus: z.string().nullable() })), url: z.string().nullable(), recurringEventId: z.string().nullable() });
  export const calendarConnector: ConnectorDefinition<{ transport: "mcp"; server: string; preset: string } | { transport: "ics"; urlSecretKey?: string; filePath?: string }>; // id "calendar", interval 15
  ```
- **Sync window:** `now−7d … now+14d`, re-fetched each run. The cursor is the provider page token within a run. Events that disappear from the window aren't deleted. Cancelled events set `status: "cancelled"`.
- **Attendee resolution:** emails resolve via `findIdentity("email", address)`.
- **Status and response mapping:**

  | Source | Maps to |
  |---|---|
  | DTO `status` `confirmed` / `tentative` | `Meeting.status: "confirmed"` |
  | DTO `status` `cancelled` | `"cancelled"` |
  | Self attendee `responseStatus` `accepted` / `tentative` / `declined` / `needsAction` (or `needs_action`) | `selfResponse` `accepted` / `tentative` / `declined` / `needs_action` |
  | Anything else | null |
- **ICS transport:**
  - fetch the URL (secret) or read the file;
  - expand RRULEs with `ical.js` inside the window;
  - `externalId` = `UID` + recurrence instance start;
  - `allDay` from `VALUE=DATE`.
- **Dates:** DTO times are normalised to UTC ISO strings.
- **All-day convention (pinned):** an all-day event has `allDay: true`, and:
  - the DTO `start` is local midnight of the start date;
  - the DTO `end` is local midnight of the day *after* the last day (exclusive, like ICS `DTEND;VALUE=DATE`);
  - both are expressed as UTC instants for the display time zone. For example, a one-day event on 2026-10-23 in `America/Vancouver` (UTC−7 that day) has `start: "2026-10-23T07:00:00.000Z"` and `end: "2026-10-24T07:00:00.000Z"`.

- [ ] **Step 1: Write the failing tests.**
  - A two-page fixture produces N meetings.
  - A re-sync produces no duplicates.
  - A cancelled event is marked cancelled.
  - An attendee email matching a person's identity sets `personId`.
  - A weekly RRULE in `sample.ics` yields 3 instances in the window.
  - A timed event with `TZID=America/New_York` stores the correct UTC.
  - An all-day event sets `allDay: true`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-14): calendar connector over mcp or ics`.

**Acceptance:**
- Fixture-driven tests pass for both transports.
- *(owner, after merge)* The owner's real calendar syncs through whichever transport spike S2 approved, and meetings appear on the dashboard within one sync interval.

---

### Task P1-15: EM OS MCP server

**Files:** `packages/mcp-server/src/{server.ts,tools.ts,policy.ts,tokens.ts,stdio-bridge.ts}`, `core/src/ports/repos/mcp-clients.ts`, `store-sqlite/src/repos/mcp-clients.ts`, `api-contract/src/ops/mcp-clients.ts`, `service/src/handlers/mcp-clients.ts`, `service/src/server.ts` *(mount `/mcp`; append-only route)*, `cli/src/commands/mcp.ts` + tests.

**Interfaces:**
- Consumes: the `today.get` builder (P1-10), and the people, commitments and meetings repos.
- Produces:
  - Tools (all read-only; every result includes record `id`s, ISO dates and stored source `url`s where present):
    - `today { date? }` → the `Today` summary (header, timeline meetings, top with why, waitingOn)
    - `list_commitments { direction?, status?, person?, due_before? }`
    - `get_person { name_or_id }` → the profile `{ person, openMine, openTheirs, notes? }`, or `{ matches: { id, displayName, role }[] }` when ambiguous
    - `list_meetings { from, to }`
    - `get_meeting { id }` → the meeting plus notes, filtered by policy
  - Clients: `McpClient { id, name, tokenHash (sha256), allowSensitive: boolean, createdAt, revokedAt }`.
  - Ops: `mcpClients.create { name, allowSensitive } → { client, token }` (the token is shown once), `mcpClients.list`, `mcpClients.revoke { id }`.
  - CLI:
    - `emos mcp token create <name> [--allow-sensitive]` prints the token and the line `claude mcp add --transport http emos http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`. It also stores the token in the keychain as `emos/mcp/<name>`.
    - `emos mcp --client <name>` is a stdio ↔ HTTP bridge that forwards JSON-RPC messages unchanged.
- **Policy** (`policy.ts` — a pure function of record set × client policy × request shape, no transport or store dependency, so it unit-tests without MCP):
  - Retention first (ADR 0004): `excluded` and `purged` records are never returned by any tool, resource or log — a `purged` tombstone is never re-surfaced as a note. `archived` records return only in reads that carry an explicit time scope (ADR 0004 retrieval order); `get_person`'s `notes` carry no range parameter, so they return `active` notes only.
  - `private` content is always removed — even when `allowSensitive` is true, because the MCP client's model approvals are unknown to EM OS (ADR 0012).
  - `people_sensitive` content (person notes, 1:1 notes) is included only if `allowSensitive` **and** the call targets a person explicitly (`get_person`, or `person` set in `list_commitments`).
  - `get_meeting` on a 1:1 returns notes only under the same rule.
  - When person notes are withheld (`allowSensitive: false`), the `notes` key is omitted entirely (absent key, not `[]`). The ambiguous-name `matches` payload carries only `{ id, displayName, role }` — never notes.

- **Person-note boundary (security finding L5, PR #43 security review; follow-up recorded as P1-47):** `PeopleRepo.notes`, `people.get` and `personNotes.list` intentionally stay unfiltered — authorized non-MCP consumers (the UI today, Ask later) need complete results across every sensitivity and retention state. **Do not move the filtering into `PeopleRepo`.** The MCP boundary owns the projection: `policy.ts` applies it server-side on every call (never cached across requests, never delegated to the client), and every MCP person-note surface — `get_person`, `get_meeting` on 1:1s, person-profile Markdown resources (ADR 0013), and Phase 3 `search` only via `include_sensitive` — routes through the same filter. Because the filter is the only place this logic lives, a repo-side guard test pins the repository's completeness so it cannot silently migrate inboard.

- [ ] **Step 1: Write the failing tests** (MCP `Client` over `InMemoryTransport`, or HTTP against `startService`).
  - A missing or revoked token → 401.
  - `get_person("sam")` with two Sams → `matches` of length 2.
  - `get_person` with `allowSensitive: false` → no `notes` key.
  - With `allowSensitive: true` → notes are included.
  - A `private` note never appears — in `get_person`, in `get_meeting` notes or person-profile Markdown resources, and never in the logs either (requests are logged as ids and counts only, ADR 0013).
  - With `allowSensitive: true`, `get_person` returns `active` `normal` and `people_sensitive` notes; an `archived` note (no explicit time scope exists for it in Phase 1) and an `excluded` note are absent from the result.
  - A `purged` person note (tombstone, `text` emptied) never appears in `get_person` results, even for a sensitive-allowed client.
  - Ambiguous-name `matches` never carry notes or note text — only `{ id, displayName, role }`.
  - Boundary guard in `store-sqlite/src/repos/people.test.ts`: `PeopleRepo.notes` still returns every note — `private`, `people_sensitive` and `normal`, across `active`/`archived`/`excluded`/`purged` states (constructible via `NewPersonNote.retentionState`) — with a comment linking L5/P1-47, so the MCP filter cannot migrate into the repository.
  - Service guard in `service/src/handlers/people.test.ts`: `people.get` and `personNotes.list` keep returning complete authorized results, including `private` notes.
  - `today` returns top items with their `why`.
  - The stdio bridge round-trips `tools/list`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with `@modelcontextprotocol/sdk` `McpServer` + `StreamableHTTPServerTransport`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-15): read-only emos mcp server with per-client tokens`.

**Acceptance:** After `claude mcp add …`, Claude Code answers "what do I owe Sam?" from EM OS data. A client without sensitive access never sees person notes. No MCP tool, resource or log ever returns `private` content or an `excluded`/`purged` record under any client policy (L5); `people_sensitive` notes appear only under the pinned `allowSensitive` + explicit-person-target rule; `archived` notes stay out of scope-less reads — and `PeopleRepo.notes`, `people.get` and `personNotes.list` keep returning complete authorized results for non-MCP consumers.

---

### Task P1-16: Synthetic em-template fixture workspace

**Files:** `packages/importer-em-template/fixtures/workspace/**` and `packages/importer-em-template/fixtures/EXPECTED.md` (the expected counts per entity).

**Interfaces:**
- Produces a synthetic workspace that P1-17 … P1-22 test against. It must contain, with synthetic people only:

  | Area | Contents |
  |---|---|
  | People | 3 People files (one with `**Pronouns:** <!-- TODO: confirm -->`, one named `Zoë Quinn`) |
  | Stakeholders | 3 Stakeholders files (one is the same human as a People file) |
  | 1:1s | 4 1:1 notes across 2 people, with Career / Wellbeing / Feedback / "For their People/ file" sections and action items |
  | Standups | 3 standup files (one `-multifecta` suffix) with action items for others and for self |
  | Daily logs | 3 daily logs, with an `auto-today` sentinel block and a `## Meeting —` section |
  | Todos | `TODO.md` (generated, to be skipped) plus checkbox todos covering every tag in [the format notes](../../../docs/importers/em-template.md#todo-grammar), including one line with two id markers |
  | Other | a risk register with an inline corroboration, 1 workstream, 1 decision, `My-Growth/brag-doc.md`, 1 JD, `Acronyms.md`, 1 weekly summary |
  | Drift | one file with CRLF endings, one with a missing standard section, one unparseable todo line |

- [ ] **Step 1: Author the files, `EXPECTED.md`** (counts per entity, active vs. archived todos, the expected merge and unknown-pronoun list) **and `fixtures/mtimes.json`**. `mtimes.json` maps each fixture path to a fixed ISO modified time, because git checkouts reset real mtimes. Expected counts assume the import date `2026-10-20` and these mtimes. The self person in the fixture is the synthetic `Morgan Lee`.
- [ ] **Step 2: Run `node scripts/check-fixtures.mjs packages/importer-em-template/fixtures`.** Expected: no violations.
- [ ] **Step 3: Commit** `test(p1-16): synthetic em-template workspace fixture`.

**Acceptance:** Every mapping row in the format notes is exercised at least once.

---

### Task P1-17: Importer framework + parsers

**Files:** `packages/importer-em-template/src/{framework.ts,markdown.ts,todo-line.ts,frontmatter.ts}` + tests.

**Interfaces:**
- Produces:
  ```ts
  export interface Section { heading: string; level: number; startLine: number; lines: string[]; children: Section[] }
  export function parseMarkdown(text: string): { frontmatter: Record<string, unknown>; sections: Section[]; lineCount: number }; // normalises CRLF
  export interface TodoLine { done: boolean; date: LocalDate | null; owners: string[]; text: string; priority: 0|1|2|3|null; urgency: Urgency | null; due: LocalDate | null; blocked: boolean; waitingOn: string | null; tags: string[]; workstream: string | null; supersedes: string[]; ids: string[]; line: number }
  export function parseTodoLine(line: string, lineNo: number): TodoLine | null;   // null if not a checkbox line
  export interface ImportUnit { key: string; entity: string; describe: string; apply(store: Store, ctx: ImportCtx): { entityId: string; created: boolean } }
  export interface ImportCtx { ids: IdGen; clock: Clock; timeZone: string; selfPersonId: string; selfName: string; personByName(name: string): string | null; goalBySlug(slug: string): string | null; unparseable(file: string, line: number, reason: string): void }
  export interface SourceFs { read(p: string): string; list(glob: string): string[]; mtime(p: string): Date }   // tests pass a SourceFs backed by fixtures/mtimes.json
  export interface Importer { name: string; collect(root: string, fs: SourceFs, ctx: ImportCtx): ImportUnit[] }
  export function runUnits(store: Store, units: ImportUnit[], ctx: ImportCtx, dryRun: boolean): ImportReportCounts;   // idempotent via import_keys; dryRun applies inside a rolled-back transaction
  ```

- [ ] **Step 1: Write the failing tests.**
  - `parseMarkdown` on a CRLF file gives the same sections as on LF.
  - Nested `##` / `###` build a tree.
  - `parseTodoLine("- [ ] 2026-09-22 — ([[People/Jane-Doe|Jane]] + Morgan) **Share test matrix** !next #ws:proj-x #risk-R8 <!-- id:teamv2readpaths --> <!-- id:a1b2c3 -->", 3)` → owners `["Jane Doe", "Morgan"]`, urgency `next`, workstream `proj-x`, tags `["risk-R8"]`, ids `["a1b2c3", "teamv2readpaths"]` (6-char first).
  - `!waiting-jordan` → `waitingOn: "jordan"`.
  - `!2026-10-30` → due.
  - A plain bullet → null.
  - `runUnits` twice → the second run creates 0 records.
  - `dryRun` leaves the DB unchanged.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-17): importer framework and markdown/todo parsers`.

**Acceptance:** The parsers tolerate the fixture's drift cases. Units are idempotent.

---

### Task P1-18: People + Stakeholders import

**Files:** `packages/importer-em-template/src/importers/people.ts` + test.

**Interfaces:**
- Consumes: P1-17 framework, `PeopleRepo` (P1-01).
- Produces `peopleImporter: Importer`, which yields units for `person`, `identity` and `person_note`. It runs first, and later importers resolve names through `ctx.personByName`.
- **Mapping:** per the format notes' People/Stakeholders rows:
  - `relationship`: People → `direct_report`; Stakeholders → `stakeholder`, unless a "manager" or "peer" keyword appears in the role line;
  - pronouns: `<!-- TODO: confirm -->` or absent → null;
  - each dated bullet in Running contribution notes, Context on them, Six-month rollup, Comms preferences or How they like feedback → one `people_sensitive` note dated from the bullet (else `fs.mtime(file)`).
- **Merge:** a People file and a Stakeholders file are the same human if a normalised display name, an alias or a chat handle matches. They merge into one person, People-file fields win, and the merge is listed in the report.

- [ ] **Step 1: Write the failing tests** against the fixture.
  - The person count equals `EXPECTED.md`.
  - The merged human appears once, with both files' notes.
  - `Zoë Quinn` imports with the accent intact.
  - The TODO-pronoun person has `pronouns: null` and is listed in `unknownPronouns`.
  - All notes are `people_sensitive`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-18): import people and stakeholders`.

**Acceptance:** Everyone in the workspace becomes one person each, with their identities and dated notes.

---

### Task P1-19: Meetings, notes and daily-log import

**Files:** `packages/importer-em-template/src/importers/meetings.ts` + test.

**Interfaces:**
- Consumes: the P1-17 framework, `MeetingsRepo` / `SourceItemsRepo` (P1-04), and `ctx.personByName`.
- Produces `meetingsImporter: Importer` covering:
  - **1:1 files:**
    - meeting (`one_on_one`, `personId` from the folder name, start at 09:00 local on the file date when there's no time, `connectorId: "import"`);
    - one note source item per file, split into chunks per section with section sensitivity: Career / Wellbeing / Feedback / "For their People/ file" → `people_sensitive`, else `normal`. Store the per-section sensitivity on the source item as `sections: { heading, sensitivity, startLine }[]`, then compute the record maximum;
    - action items owned by others → `meeting.actionItems`;
    - action items owned by or owed to self → handed to P1-20 via an exported `collectMeetingTodos()`.
  - **Standups:** meeting `standup` with the same action-item split.
  - **Daily logs:** a note source item. Skip `auto-today` / `auto-scheduled` blocks. Each `## Meeting — <title> (<date>)` section becomes a meeting (`other`, or `standup` / `one_on_one` per the profile's meeting rules) with that section as its note.
  - **Thread markers:** a `gemini-thread-id` marker → `source_item.externalId = "gemini:<id>"`.

- [ ] **Step 1: Write the failing tests** against the fixture.
  - The meeting counts match `EXPECTED.md`.
  - The 1:1 Wellbeing section is `people_sensitive` and Discussed is `normal`.
  - The standup's other-owner items are on `actionItems`, not commitments.
  - The `auto-today` block text isn't present in any note.
  - The thread id is stored.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-19): import 1:1s, standups and daily logs`.

**Acceptance:** Meeting history is searchable later, and prep's "last notes" works on imported 1:1s.

---

### Task P1-20: Todo import + activation rule

**Files:** `packages/importer-em-template/src/importers/todos.ts` + test.

**Interfaces:**
- Consumes: `parseTodoLine` (P1-17), `CommitmentsRepo` (P1-02), `collectMeetingTodos` (P1-19), `ctx.personByName`.
- Produces `todosImporter: Importer`.
- **Scope:** scan every non-skipped `.md` file. Skip `TODO.md`, the `Leadership-Dashboard.*` files, `.claude/`, `.github/`, `bin/`, templates and READMEs.
- **Owner and direction:**
  - no owner, or an owner matching `ctx.selfName` (full or first name, case- and accent-insensitive), means self, i.e. `ctx.selfPersonId`;
  - self-owned → `direction: "mine"`, with `counterpart` = the other owner, or the file's subject person;
  - other-owned with `!waiting-<who>` or `!blocked`, or other-owned in a file about self → `owed_to_me`;
  - any other other-owned item isn't imported as a commitment. It stays on the meeting's `actionItems` (P1-19), or is reported as `skipped_not_mine`.
- **Activation:**
  - `[x]` → `done`, with `completedAt` = `fs.mtime(file)`;
  - `[ ]` + (due, priority or urgency tag, or `fs.mtime(file)` within 30 days of `ctx.clock.now()`) → `proposed`, `createdBy: "import"` (activated on the proposals review screen, P1-32 / P1-38);
  - otherwise → `dropped`, `dropReason: "archived_on_import"`.
- **Supersedes:** `#supersedes:<id>` → drop the referenced item with `dropReason: "merged"`.
- **Keys:** `todo:<6-char id>`, falling back to `todo:<file>:<sha1(text)>`.

- [ ] **Step 1: Write the failing tests** against the fixture.
  - The active / archived / done counts match `EXPECTED.md`.
  - The two-id line imports once.
  - The `!waiting-jordan` item becomes `owed_to_me` with Jordan as counterpart.
  - The superseded item is `dropped (merged)`.
  - Generated `TODO.md` lines aren't imported twice.
  - The unparseable line is reported with file:line.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-20): import todos with activation rule`.

**Acceptance:** Day one starts with a small reviewable set, not hundreds of stale items.

---

### Task P1-21: Risks, decisions, goals, growth and reference import

**Files:** `packages/importer-em-template/src/importers/other.ts`, `store-sqlite/src/repos/{risks,decisions,documents}.ts`, `core/src/ports/repos/{risks,decisions,documents}.ts` (minimal `create` / `list`) + test.

**Interfaces:**
- Produces `otherImporter: Importer` mapping:

  | Source | Becomes |
  |---|---|
  | Risk register rows | `risk`; each inline `**YYYY-MM-DD** …` corroboration → a dated note source item, linked via `record_sources` |
  | Decisions | `decision` + a note source item |
  | Workstreams | `goal { kind: "project", horizon: "ongoing" }`; the slug is stored as `goal.slug`, and P1-20 resolves `#ws:` tags via `ctx.goalBySlug` |
  | `My-Growth/brag-doc.md` | one `accomplishment` (self, `accepted`) per dated bullet |
  | Development plan | `goal { kind: "personal_growth", subjectPersonId: self }` per goal heading |
  | Promotion path and `JobDescriptions/*` | `document { kind: "rubric" }` + a note source item |
  | Weekly summaries / reports | a note source item |
  | `Acronyms.md`, `Systems/inventory.md` | a note source item (`normal`) |

- [ ] **Step 1: Write the failing tests** against the fixture.
  - The risk count matches and its corroboration is a separate dated note.
  - The workstream becomes a goal.
  - The brag bullets become N accomplishments.
  - The JD is a rubric document.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-21): import risks, decisions, goals, growth and reference notes`.

**Acceptance:** Nothing in the workspace is lost. It's either a typed record or a dated note.

---

### Task P1-22: Dry-run report, apply, CLI, import ops

**Files:** `packages/importer-em-template/src/{index.ts,report.ts,config-proposals.ts}`, `api-contract/src/ops/import.ts`, `service/src/handlers/import.ts`, `cli/src/commands/import.ts` + tests.

**Interfaces:**
- Produces:
  ```ts
  export interface ImportReport { counts: Record<string, { create: number; update: number; skip: number }>; merges: { person: string; files: string[] }[]; unknownPronouns: string[]; todos: { proposed: number; archived: number; done: number; skippedNotMine: number }; unparseable: { file: string; line: number; reason: string }[];
    proposedConfig: { selfName: string | null; roster: { name: string; relationship: Relationship; handles: Record<string, string> }[]; repos: string[]; meetingRules: Profile["meetingRules"]; displayTimeZone: string | null; workstreams: string[] } }
  export function importEmTemplate(root: string, deps: { store: Store; ids: IdGen; clock: Clock }, opts: { dryRun: boolean; selfName: string }): ImportReport;
  ```
- **Order:** people → other (for workstream slugs) → meetings → todos.
- **Ops:**
  - `import.dryRun { path, selfName } → ImportReport`
  - `import.apply { path, selfName } → ImportReport`
  - Review of imported items uses the generic `proposals.list` / `proposals.decide` ops (P1-38).
- **Self person:** `importEmTemplate` finds the person whose name matches `selfName` (relationship `self`), or creates one. It sets `profile.selfPersonId` if that's null, before any other unit runs.
- **CLI:** `emos import em-template <path> --self "<name>" [--apply]`. It prints the report as a table; without `--apply` it's a dry run.
- **Guards:** the importer only reads the source. The path must exist and must not be the data dir.

- [ ] **Step 1: Write the failing tests.**
  - The fixture dry run equals `EXPECTED.md` counts, and the DB is unchanged.
  - Apply then apply again → the second report is all `skip` / `update`, with 0 creates.
  - Importing into an empty store creates exactly one `self` person and sets `profile.selfPersonId`. Re-importing doesn't create a second.
  - `proposedConfig.roster` lists the fixture's direct reports with handles.
  - The source files' mtimes and hashes are unchanged after apply.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-22): import report, apply and review ops`.

**Acceptance:** The owner can dry-run, read the report, apply, and review in one sitting. Re-running is safe.

---

### Task P1-23: Header strip + week-load widgets + layout editing

**Files:** `webview/src/widgets/{Header.tsx,WeekLoad.tsx}`, `webview/src/grid/{WidgetGrid.tsx,LayoutMenu.tsx}`, `webview/src/state/today.ts` (shared hook: `useToday()` calls `today.get` and refreshes on `items.changed` / `sync.status`; owned here, used by P1-24 … P1-26) + tests.

**Interfaces:**
- Consumes: the `Today` type (P1-10), `layout.get` / `layout.set` (P1-05), `rpc` / `onEvent` (P0-14).
- Produces: `export function useToday(localDate?: LocalDate): { data: Today | null; error: ApiError | null; refresh(): void }`.
- **Header:** date, `N meetings · Xh free`, and chips:
  - `⚑ N to triage` (hidden when 0);
  - `synced Xm ago`, in error colour when `failingConnectors` is non-empty;
  - a `Refresh plan` button that calls `today.refresh`.
- **Week load:** a vertical bar per day, height = `loadRatio`. Overloaded days use `--vscode-errorForeground`, and today is outlined. Due chips sit under each day. Clicking a chip opens its commitment (`command: emos.openCommitment`).
- **Layout menu:** per-widget move up / move down / remove, and an "Add widget" list. It persists via `layout.set("dashboard")`.

- [ ] **Step 1: Write the failing tests** (jsdom, fake `rpc`).
  - **Empty:** with `onboarded: false`, it renders `Run setup` and no chips.
  - `⚑ 3 to triage` shows when `toTriage: 3`.
  - The overloaded day has `data-overloaded="true"`.
  - Removing a widget calls `layout.set` without it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use SVG / CSS only, with no charting library, and theme variables only.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-23): header and week load widgets with editable layout`.

**Acceptance:** It matches the approved visual direction (cards, chips, bars) in light and dark themes, and is keyboard reachable.

---

### Task P1-24: Today timeline widget

**Files:** `webview/src/widgets/Timeline.tsx` + test.

**Interfaces:**
- Consumes: `useToday` (P1-23), `Today.timeline` (P1-10).
- **Layout:** a vertical timeline across working hours.
- **Meetings:** blocks positioned by local time, each with a prep chip:
  - `needs_work` → `prep` in the warning colour;
  - `ready` → `ready`;
  - `nothing_linked` → no chip.

  Clicking a meeting opens prep (`command: emos.openPrep`).
- **Free blocks:** hatched, labelled `Focus · 1.5h`, with `→ <placed item title>` lines.
- **Now line:** a red line at the current local time, re-rendered every minute.

- [ ] **Step 1: Write the failing tests.**
  - A 13:00 meeting is positioned below an 11:00 one.
  - A `needs_work` meeting shows `prep`.
  - A focus block lists its placed item.
  - The now line is hidden for a non-today date.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-24): today timeline with focus blocks`.

**Acceptance:** You can see at a glance when you're free and what goes there.

---

### Task P1-25: Do-these-5 + waiting-on widgets

**Files:** `webview/src/widgets/{TopFive.tsx,WaitingOn.tsx,ProgressRing.tsx}` + tests.

**Interfaces:**
- Consumes: `useToday`; the ops `commitments.complete`, `commitments.snooze` and `commitments.reopen`.
- **Top five:** numbered cards showing a source icon (`manual` / `meeting` / `import`, inferred from `createdBy` and sources), the title, a why chip, and the progress ring `done/total`.
- **Card actions:**
  - check → `complete`; an undo toast offers `reopen` for 5 s;
  - snooze menu → `snooze` (later today, tomorrow, next week);
  - open → `emos.openCommitment`.
- **Done cards** are struck through and keep their slot.
- **Waiting on:** chips with person name, title and due. Overdue chips use the error colour.

- [ ] **Step 1: Write the failing tests.**
  - The why chip text renders exactly.
  - Check calls `commitments.complete` with the id.
  - A done card has `aria-checked="true"` and a line-through.
  - An overdue waiting-on chip has `data-overdue`.
  - The cards are keyboard operable (Enter / Space checks, `s` snoozes).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-25): top five and waiting-on widgets`.

**Acceptance:** The whole morning list can be worked without the mouse.

---

### Task P1-26: Sidebar view

**Files:** `webview/src/Sidebar.tsx` (replaces the P0 placeholder) + test.

**Interfaces:**
- Consumes: `useToday`.
- **Contents:**
  - next meeting with a countdown (`in 52m`) and its prep dot;
  - the top 3 non-done items with urgency dots;
  - the triage badge;
  - a progress bar and `2 of 5 done · open dashboard ↗` (`command: emos.openDashboard`).

- [ ] **Step 1: Write the failing tests.**
  - The countdown text for a meeting 52 minutes away is `in 52m`.
  - Done items are excluded.
  - The link posts `emos.openDashboard`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-26): compact sidebar`.

**Acceptance:** It's useful at 250 px wide.

---

### Task P1-27: Commands: quick capture, note about person, refresh, sync

**Files:** `extension/src/commands/{quickCapture.ts,personNote.ts,misc.ts,index.ts}`, `extension/package.json` *(append-only: `contributes.commands` / `keybindings`)* + tests.

**Interfaces:**
- Consumes: `commitments.quickCapture` (P1-03), `people.resolve` / `people.create` / `personNotes.create` (P1-01), `today.refresh`, `connectors.sync`.
- **Commands:**

  | Command | Behaviour |
  |---|---|
  | `emos.quickCapture` (`cmd/ctrl+alt+n`) | InputBox with placeholder `Send slides @sam !fri !p1 #tag`. On `needs_person`: a QuickPick of candidates plus `Create "<query>"`. |
  | `emos.noteAboutPerson` (`cmd/ctrl+alt+m`) | QuickPick person, then a multi-line InputBox, an optional date (defaults to today), then save. |
  | `emos.refreshPlan`, `emos.syncNow` | Run `today.refresh` / `connectors.sync` (all enabled connectors). |

  Plus `emos.openCommitment`, `emos.openPrep`, `emos.openPerson`, `emos.openGoals`, `emos.openWrap` and `emos.openSettings`, which open the panels from P1-28 … P1-31 with an `id` argument.

- [ ] **Step 1: Write the failing tests** (mocked `vscode.window`).
  - Quick capture with an ambiguous `@sam` shows 2 candidates plus Create, and the picked id is sent as `counterpartId`.
  - An empty title shows an error message, and nothing is created.
  - A note defaults to today.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-27): capture and note commands`.

**Acceptance:** Capturing a commitment or a note takes under 5 seconds from anywhere in VS Code.

---

### Task P1-28: Person page (minimal) + goals view

**Files:** `webview/src/views/{Person.tsx,Goals.tsx}`, `webview/src/router.ts` (view routing for `emos.view` panels; owned here), `extension/src/panels/view.ts` (generic panel opener, owned here; reused by P1-29 … P1-32) + tests.

**Interfaces:**
- Produces:
  - `openView(kind: "person" | "goals" | "prep" | "wrap" | "settings" | "importReview" | "commitment", id?: string)` in the extension, which reuses one panel per kind;
  - the webview `router` renders by `kind`.
- **Person page:**
  - **Header:** name, role, relationship, and pronouns (`unknown, using they/them` when null, with a `Confirm pronouns` action → `people.update`).
  - **Columns:** *You owe* (`openMine`), *They owe* (`openTheirs`).
  - **Notes:** a dated list, newest first, with a sensitivity badge and an inline add-note form (text, date, tags).
  - **Recent 1:1s:** `meetings.list { personId, classification: "one_on_one", from: −90d, to: now }`, each linking to the meeting prep view.
- **Goals view:** the goal list grouped by kind, with create / edit (title, horizon, kind, subject, target date, status) and a linked commitments count.
- **Commitment detail view:** fields, audit trail, sources with links, and edit.

- [ ] **Step 1: Write the failing tests.**
  - Null pronouns render `pronouns: unknown, using they/them`.
  - The add-note form posts `personNotes.create` with `date`.
  - Goals group by kind.
  - The commitment view lists audit events in order.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-28): person page, goals and commitment views`.

**Acceptance:** Notes can be added to anyone's profile, and open items in both directions are visible per person.

---

### Task P1-29: Meeting prep panel + paste notes

**Files:** `webview/src/views/Prep.tsx` + test.

**Interfaces:**
- Consumes: `prep.get` (P1-09), `meetings.get` / `meetings.attachNotes` / `meetings.update` (P1-04), `openView` (P1-28).
- **Panel contents:**
  - title, time, a classification selector (→ `meetings.update`), and the status chip;
  - for 1:1s: *You owe*, *They owe*, *Last time* (excerpt plus open note);
  - for standups: *Carried over* action items;
  - *Linked to this meeting* commitments, with a `Link item…` picker;
  - *Notes*: a textarea plus a Summary / Transcript toggle → `attachNotes`, then the list of attached notes.

- [ ] **Step 1: Write the failing tests.**
  - The 1:1 prep shows both columns.
  - The standup shows carried items.
  - Pasting a transcript calls `attachNotes` with `kind: "transcript"`.
  - Changing the classification calls `meetings.update`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-29): meeting prep with pasted notes`.

**Acceptance:** Every 1:1 on today's timeline opens to useful prep, and meeting notes can be captured until Phase 2 automates them.

---

### Task P1-30: End-of-day wrap view

**Files:** `webview/src/views/Wrap.tsx` + tests. The nudge belongs to P1-41.

**Interfaces:**
- Consumes: `wrap.get` / `wrap.apply` (P1-11), `settings.get` (`eodNudgeTime`).
- **View:**
  - one row per item with segmented actions `Done · Tomorrow · Re-date · Drop` and a `Worth remembering` toggle on Done;
  - an "Anything else worth remembering?" textarea;
  - a tomorrow preview;
  - a single `Wrap up` button → `wrap.apply`.

- [ ] **Step 1: Write the failing tests.**
  - Re-date shows a date input and blocks submit until it's set.
  - `Wrap up` sends one `wrap.apply` with all decisions.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-30): end-of-day wrap view`.

**Acceptance:** The wrap takes about two minutes and leaves tomorrow's list clean.

---

### Task P1-31: Onboarding wizard + settings view

**Files:** `webview/src/views/{Onboarding.tsx,Settings.tsx}`, `extension/src/onboarding.ts` (opens the wizard on first activation when `onboarded: false`) + tests.

**Interfaces:**
- Consumes: `settings.*` (P1-05); `people.create` / `people.addIdentity` (P1-01); `connectors.list` / `configure` / `sync` (P1-12); the calendar connector config shape (P1-14); `discovery.*` ops (P1-34); `import.dryRun` (P1-22, optional step).
- **Wizard steps:**
  1. **You:** name; chat / code-host / email handles → self person + identities; `selfPersonId`.
  2. **Time:** display time zone (default from `Intl`), work week, working hours, end-of-day nudge time.
  3. **Team:** add people (name, relationship, handles, pronouns optional), or "I'll import them" (skips to step 6).
  4. **Meetings:** title rules (pre-filled examples `^standup`, `1:1|1-1|one on one`).
  5. **Calendar:**
     - choose `MCP server` or `ICS` (URL stored as a secret, or a file);
     - for MCP, **discovery** (P1-34): detected servers → tool catalog grouped by server (and by provider/service with an aggregator adapter) → suggested read tool per capability with the top-3 alternatives → `Test` shows the mapped preview → save as preset;
     - `Test` runs `connectors.sync` and shows the meeting count.
  6. **Import (optional):** the em-template path → dry-run report → `Review import` (P1-32).
  7. **Done:** set `onboarded: true` and open the dashboard.
- **Settings view:** the same sections as editable forms, plus connector status rows (state, last success, last error, `Sync now`) and MCP clients (`mcpClients.list` / `revoke`; the create flow shows the `claude mcp add` line once).
- **Responsibility note:** shown verbatim on the Calendar step and in Settings → Connectors: "Check that your employer allows the services you connect here to be used this way."

- [ ] **Step 1: Write the failing tests.**
  - The wizard can't finish without a self name and a time zone.
  - The calendar `Test` shows `Found 12 meetings` from a fake `connectors.sync`.
  - Write tools in the catalog render disabled, with the label `write — not used by EM OS`.
  - Settings shows a red error row for a connector in `error` state with its message.
  - Creating an MCP client shows the token once, and it's absent after re-render.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-31): onboarding wizard and settings`.

**Acceptance:**
- A fresh install, using fake connectors, completes the wizard and lands on a populated dashboard (component tests plus smoke).
- *(owner, after merge)* The owner completes onboarding against their real calendar.

---

### Task P1-32: Proposals review screen

**Files:** `webview/src/views/Proposals.tsx`, `webview/src/views/ImportReport.tsx` + tests.

**Interfaces:**
- Consumes: `import.dryRun` / `import.apply` (P1-22), `proposals.list` / `proposals.decide` (P1-38).
- **Report:** counts per entity, merges, unknown pronouns (with links to confirm on the person page), unparseable lines (file:line), and proposed config (checkboxes to apply each value via `settings.update` / `people.update`).
- **Review list:** all proposals, meaning imported commitments, MCP-proposed commitments and MCP-proposed person notes, grouped by source (`import`, or the MCP client name) and then by counterpart. Each has Keep / Drop. Bulk `Keep all shown` / `Drop all shown`, and filters (source, has due date, priority, person). Submit → `proposals.decide`. The header badge shows the proposal count; this screen is the Phase 1 stand-in for triage.
- **Keyboard:** `k` keep, `d` drop, `j` / `↓` next.

- [ ] **Step 1: Write the failing tests.**
  - The report renders the `unparseable` rows with file:line.
  - `Keep all shown` with the "has due date" filter keeps only the dated items.
  - Keyboard `k` / `d` marks the focused row.
  - Submitting sends the kept and dropped id lists.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-32): proposals review screen`.

**Acceptance:** About 100 imported items can be reviewed in under 5 minutes.

---

### Task P1-34: Tool discovery

**Files:** `packages/connectors/src/discovery/{detect.ts,catalog.ts,classify.ts,match.ts}`, `api-contract/src/ops/discovery.ts`, `service/src/handlers/discovery.ts`, `packages/connectors/fixtures/discovery/{claude.json,vscode-mcp.json,tools-list.json}` + tests.

**Interfaces:**
- Consumes: `McpServerDef`, `loadServers` and `createMcpInvoker` (P1-13).
- Produces:
  ```ts
  export function detectServers(env: { home: string; cwd: string | null; platform: NodeJS.Platform; appData: string | null }, exists: (p: string) => boolean, read: (p: string) => string): { source: "claude-user" | "claude-project" | "vscode"; server: McpServerDef }[];
  export interface ToolEntry { server: string; name: string; description: string; inputSchema: unknown; access: "read" | "write"; accessReason: "annotation" | "verb" | "unknown"; group: { provider: string | null; service: string | null }; accessible: boolean | null; blockedReason: string | null }
  export function classifyTool(t: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }): { access: "read" | "write"; reason: ToolEntry["accessReason"] };
  export interface CapabilitySpec { id: string; keywords: string[]; params: string[] }   // e.g. calendar.listEvents: keywords [calendar, event, list|get], params [time|start, end|max]
  export function suggestTools(cap: CapabilitySpec, catalog: ToolEntry[]): { tool: ToolEntry; score: number }[]; // read tools only, top 3, deterministic
  ```
- **Detection sources:**
  - `~/.claude.json` (`mcpServers` at the top level and per-project);
  - `<cwd>/.mcp.json`;
  - VS Code user `mcp.json`, at `~/Library/Application Support/Code/User/mcp.json` on macOS and `%APPDATA%\Code\User\mcp.json` on Windows.
- **Classification:** the `readOnlyHint` annotation wins. Otherwise the first verb token of the name, after stripping any provider prefix, decides:
  - read: `get`, `list`, `search`, `read`, `fetch`, `query`, `find`, `describe`, `summarize`;
  - write: `create`, `update`, `delete`, `send`, `post`, `share`, `move`, `trash`, `untrash`, `set`, `respond`, `book`, `edit`, `merge`, `transition`, `upload`, `add`, `remove`, `mark`, `schedule`, `restore`, `revoke`;
  - anything else is `write` with reason `unknown`.
- **Ops:**
  - `discovery.servers → detected servers`;
  - `discovery.tools { server } → ToolEntry[]`;
  - `discovery.suggest { server, capabilities: string[] } → Record<capability, suggestions>`;
  - `discovery.test { server, preset } → { items: unknown[]; mappedPreview: unknown[] }`;
  - `discovery.savePreset { preset }`.

- [ ] **Step 1: Write the failing tests.**
  - `detectServers` finds servers in all three fixture configs.
  - `classifyTool({ name: "google_calendar_get_events" })` → `read`.
  - `chat_post_message` → `write`.
  - `jira_transition_ticket` → `write`.
  - `foo_frobnicate` → `write` with reason `unknown`.
  - `readOnlyHint: true` on a `create_x` name → `read` with reason `annotation`.
  - `suggestTools(calendar.listEvents)` over the fixture `tools-list.json` ranks a `*_calendar_get_events` tool first and never returns a write tool.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-34): mcp tool discovery, read/write classification and capability matching`.

**Acceptance:**
- Fixture-based tests pass.
- *(owner, after merge)* On the owner's machine, onboarding lists their MCP servers and tools. It proposes a correct read tool for `calendar.listEvents`, and offers no write tools.

---

### Task P1-35: Plugin loader + aggregator adapter interface + reference adapter

**Files:**
- `packages/plugin-api/src/index.ts` — a new public package, `@emos/plugin-api`. It holds only types and the `register` contract, so external plugins depend on this alone.
- `packages/service/src/plugins.ts` — the loader.
- `packages/connectors/src/discovery/aggregator.ts` — the registry, plus discovery integration.
- `packages/plugins/example-gateway/` — the reference adapter, with synthetic fixtures.
- `docs/plugins/writing-an-aggregator-adapter.md`.
- Tests beside each.

**Interfaces:**
- Produces (in `@emos/plugin-api`):
  ```ts
  export interface AggregatorAdapter {
    id: string;
    detect(tools: { name: string }[]): boolean;                                   // e.g. presence of the gateway's own discovery tools
    enrich(callReadTool: ReadToolCaller, catalog: ToolEntry[]): Promise<ToolEntry[]>; // fill group.provider/service, accessible, blockedReason
    health?(callReadTool: ReadToolCaller): Promise<{ provider: string; errorRatePct: number; calls: number }[]>;
    knownPresets?(): PresetDef[];
  }
  export type ReadToolCaller = (toolName: string, args: Record<string, unknown>) => Promise<unknown>; // raw MCP call, refused unless classifyTool() says "read"
  export interface PluginApi { apiVersion: 1; registerAggregator(a: AggregatorAdapter): void; registerPreset(p: PresetDef): void; log: Logger }
  export interface EmosPlugin { name: string; version: string; register(api: PluginApi): void | Promise<void> }
  ```
  `ToolEntry`, `PresetDef`, `CapabilityInvoker` and `Logger` are re-exported from their owning packages.
- **Loader:**
  - Reads `<dataDir>/config/plugins.json`, shaped `{ "plugins": [{ "path": "/abs/path/or/package-name", "enabled": true }] }`.
  - Imports each plugin and calls `register`, with a 5 s timeout per plugin.
  - A throwing or slow plugin is disabled and recorded as `{ name, error }`.
  - Plugins never receive `Store`, `SecretStore` or raw DB access.
  - Op: `plugins.list → { name, version, path, enabled, error: string | null }[]`, shown in Settings.
- **Reference adapter** `example-gateway`:
  - `detect` checks for the tools `gateway_tool_access` and `gateway_provider_health`;
  - `enrich` groups tools by the `provider` / `service` fields from the synthetic access response;
  - it ships one known calendar preset.
  - All names are fake. Fixtures pass `check-fixtures`.
- **Guide:** the doc explains how an organisation writes a **private** adapter package (depending only on `@emos/plugin-api`), tests it against recorded responses, and points `plugins.json` at it.

- [ ] **Step 1: Write the failing tests.**
  - The loader registers the example adapter from a fixture `plugins.json`.
  - A plugin that throws in `register` → it's listed with its error and the service still starts.
  - A plugin exceeding 5 s → disabled.
  - The `PluginApi` object has no `store` / `secrets` keys.
  - The example adapter's `detect` is true only with both gateway tools present.
  - `enrich` sets `group.service: "calendar"` and `accessible: false` with the fixture's reason.
  - Known presets pass `Preset.parse`.
  - Discovery (P1-34) uses an adapter when `detect` matches.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `import(pathToFileURL(path).href)` for paths and `import(name)` for packages.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-35): plugin loader and aggregator adapter interface with reference adapter`.

**Acceptance:**
- An external adapter in a separate directory, depending only on `@emos/plugin-api`, loads via `plugins.json` and enriches discovery.
- The public repo contains no real gateway's names.
- *(owner, after merge)* The owner's internal adapter is built in their private repo. It's tracked there, not on this board.

---

### Task P1-36: Trust and exit

**Files:** `api-contract/src/ops/data.ts`, `service/src/handlers/data.ts`, `service/src/export.ts`, `webview/src/views/Health.tsx`, `extension/src/commands/data.ts` + tests.

**Interfaces:**
- Consumes: the doctor checks from P0-12 (factor them into `service/src/health-checks.ts`, which `emos doctor` and this task both use), connectors (P1-12), and MCP clients (P1-15).
- Produces:
  - **Ops:**
    - `health.checks → { id: string; label: string; ok: boolean; detail: string }[]`;
    - `data.export { dest, includePrivate?: boolean } → { path; bytes }` — a zip containing `entities/<entity>.json`, plus `markdown/people/<name>.md`, `markdown/commitments.md` and `markdown/meetings/<date>.md`;
    - `data.deleteAll { confirm: "delete" } → { deleted: true }`.
  - **Commands:** `emos.health`, `emos.openDataFolder`, `emos.exportData` (save dialog), `emos.deleteAllData`. The delete command asks for `delete` in an InputBox, warns that it can't be undone and suggests exporting first, then calls the op, and the extension shows "EM OS data deleted".
- **`deleteAll`:**
  1. revoke all MCP client tokens;
  2. stop the scheduler;
  3. close the DB;
  4. delete the data directory;
  5. delete keychain entries under service `em-os`;
  6. stop the service.

  Steps 1–5 are best-effort, each reported separately.

- [ ] **Step 1: Write the failing tests.**
  - `deleteAll` without `confirm: "delete"` → `invalid_input`.
  - After `deleteAll`, the data dir doesn't exist and keychain `get("emos/token")` is null.
  - The export zip contains `entities/people.json` and the people Markdown files.
  - The export excludes `private` content unless `includePrivate: true`.
  - `health.checks` reports a failing connector with its error detail.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `node:zlib` plus a minimal zip writer, or a small audited dependency recorded per the ADR 0002 ledger.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-36): health panel, export and delete-all-data`.

**Acceptance:** A user can see what EM OS holds, take it with them, and remove it completely in under a minute.

---

### Task P1-37: Marketplace and Open VSX publishing *(manual + CI)*

**Files:** `.github/workflows/release.yml`, `packages/extension/{README.md,CHANGELOG.md,PRIVACY.md,icon.png}`, `packages/extension/package.json` (`publisher`, `repository`, `categories`, `galleryBanner`).

**Interfaces:**
- Consumes: the P0-15 packaging, and the P0-03 decision on platform-specific VSIXs.
- Produces: a `v*` tag that builds the VSIX (or one per target), runs smoke, then publishes with `vsce publish` (Marketplace PAT secret `VSCE_PAT`) and `ovsx publish` (`OVSX_PAT`), and attaches the files to the GitHub Release.

- [ ] **Step 1 (owner):** create the Marketplace publisher and the Open VSX namespace, and add both tokens as repo secrets.
- [ ] **Step 2:** write the listing README: what it does, screenshots from synthetic data, the getting-started steps, and the requirements (VS Code; optional Claude Code / API key; optional Ollama). Write `PRIVACY.md`: local storage, egress per provider, no telemetry, export / delete.
- [ ] **Step 3:** add `release.yml`. Dry-run it on a `v0.0.0-rc` tag with publishing disabled, and confirm the artifacts.
- [ ] **Step 4 (owner):** publish `v0.1.0` as a pre-release (`--pre-release`), then install it from the gallery into a clean profile and complete onboarding.
- [ ] **Step 5: Commit** `ci(p1-37): marketplace and open vsx release pipeline`.

**Acceptance:** "EM OS" installs from the VS Code gallery, auto-updates on the next release, and needs no other install to reach the dashboard.

---

### Task P1-38: MCP proposal + ingest tools, `proposals.*` ops

**Files:** `packages/mcp-server/src/tools-write.ts`, `core/src/proposals/index.ts`, `api-contract/src/ops/proposals.ts`, `service/src/handlers/proposals.ts` + tests.

**Interfaces:**
- Consumes: the P1-15 server and policy, plus the repos from P1-01, P1-02 and P1-04.
- Produces MCP tools. Each is tagged with the calling client's name in `createdBy: "mcp"` plus an audit note `client:<name>`:
  - `propose_commitment { title, direction?: "mine" | "owed_to_me", person?: string, due?: LocalDate, source_url?: string, quote?: string, occurred_at?: IsoDateTime }`
    - `person` is resolved via `resolvePerson`. If ambiguous, the result is `{ status: "needs_person", candidates }` and nothing is created.
    - With a source, a `source_item` (`origin: "mcp_ingest"`) is created and linked.
    - It creates a commitment with `status: "proposed"`.
  - `propose_person_note { person, text, date?: LocalDate, source_url?: string }` → `PersonNote { origin: "mcp", reviewState: "proposed" }`, which is only accepted if the client has `allowSensitive`.
  - `ingest_items { items: { external_id: string; kind: "transcript" | "note" | "message" | "email" | "doc_section"; title?: string; text: string; url?: string; occurred_at: IsoDateTime; calendar_event_id?: string; meeting_title?: string }[] }` → per item `{ external_id, sourceItemId, meetingId: string | null, created: boolean }`.
    - Items are upserted on `(connectorId: "mcp:<client>", external_id)`.
    - **Meeting attach:** by `calendar_event_id` (the meeting's `externalId`), else by `occurred_at` within the meeting window, ±15 min, with a case-insensitive title match. 1:1-attached items are `people_sensitive`. At most 50 items per call.
- Ops:
  - `proposals.list { source?: "import" | "mcp" | "all" } → { commitments: Commitment[]; notes: PersonNote[] }`
  - `proposals.decide { keep: string[]; drop: string[] } → { kept: number; dropped: number }`
    - commitments: keep → `activate`; drop → `dropped`, `dropReason: "user"`;
    - notes: keep → `reviewState: "accepted"`; drop → delete.
- `today.get`'s `header.toTriage` counts every proposal (commitments plus notes), whatever its source.

- [ ] **Step 1: Write the failing tests.**
  - A `propose_commitment` from client `claude` appears in `proposals.list` with audit note `client:claude`.
  - `person: "sam"` with two Sams → `needs_person`, and nothing is created.
  - `ingest_items` with a matching `calendar_event_id` attaches the item to that meeting.
  - The same `external_id` twice → `created: false`.
  - A 1:1 transcript is `people_sensitive`.
  - `propose_person_note` from a client without sensitive access → an MCP error, and nothing is stored.
  - `proposals.decide` activates a commitment and accepts a note.
  - 51 items → an `invalid_input` error.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-38): mcp proposal and ingest tools with proposals review ops`.

**Acceptance:** An MCP client can feed EM OS dated material and proposals, and nothing reaches the trusted list without the user's keep.

---

### Task P1-39: Claude Code skills pack + installer

**Files:** `integrations/claude-code/skills/{emos-update,emos-prep,emos-capture}/SKILL.md`, `integrations/claude-code/README.md`, `cli/src/commands/claude.ts`, `scripts/lint-skills.test.ts`.

**Interfaces:**
- Consumes: the P1-15 read tools and the P1-38 write tools (MCP server name `emos`).
- Produces:
  - `emos claude install-skills [--project <dir>]` copies the skills into `~/.claude/skills/` (or `<dir>/.claude/skills/`). It never overwrites a modified file without `--force`, and prints what it did.
  - `emos claude status` reports whether the `emos` MCP server is registered with Claude Code (`claude mcp list`) and whether the skills are installed.
- Each skill's frontmatter has a `name` and a `description` with trigger phrases. The bodies are org-agnostic: they tell Claude to look for suitable tools among those available and never name a specific MCP server.
  - **`emos-update [period] [audience]`**:
    1. Call `today` / `list_commitments(status: done, period)` / `list_meetings` / `get_meeting` for notes.
    2. Optionally search live sources the user has (merged PRs, closed tickets).
    3. Draft Markdown with a citation (record id or URL) on every claim.
    4. Return the draft without sending it.
    5. Never infer pronouns; use `get_person` pronouns, or they/them when they're null.
  - **`emos-prep <meeting|person>`**: resolve the meeting via `list_meetings` and the person via `get_person` (asking the user if there are several matches). Combine EM OS prep with recent chat threads involving that person, if a chat search tool exists, into an agenda.
  - **`emos-capture [since]`**:
    1. **Find capture tools** among the available tools: chat **saved-for-later items**, chat **reminders**, chat **lists / to-dos**, starred or flagged emails, and meeting **transcripts or smart notes**. Default `since` is the last run, recorded in an EM OS note tagged `emos-capture-run`, else 3 days.
    2. **Saved items, reminders and to-dos** → `propose_commitment`, with the message permalink as `source_url` and the message text as `quote`. Direction is `mine` unless the item is clearly someone else's promise.
    3. **Transcripts and notes** → `ingest_items` with `calendar_event_id` where available.
    4. Report the counts and remind the user to review proposals in EM OS.
    5. Never call write tools on external systems.

- [ ] **Step 1: Write the failing test.** `lint-skills.test.ts` parses each `SKILL.md`:
  - the frontmatter has a non-empty `name` and `description`;
  - the body references only `emos` tools by exact name, and those names exist in the P1-15 / P1-38 tool lists;
  - the body contains no server-specific tool names (it uses the P0-02 `scan` rules plus a deny-list of vendor-prefixed tool patterns).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Write the three skills, the README and the CLI commands.** `install-skills` is unit-tested against a temp home.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-39): claude code skills pack for emos`.

**Acceptance:**
- Lint and installer tests pass.
- *(owner, after merge)* In Claude Code, `/emos-capture` turns the owner's Slack saved items and reminders into proposals, and attaches the day's Meet transcripts to meetings. `/emos-update 1w` produces a cited draft.

---

### Task P1-40: People cadence widget

**Files:** `core/src/people/cadence.ts`, `api-contract/src/ops/cadence.ts`, `service/src/handlers/cadence.ts`, `webview/src/widgets/Cadence.tsx` + tests.

**Interfaces:**
- Consumes: the people and notes repos (P1-01), meetings (P1-04), `useToday` (P1-23, for refresh), and the widgets registry.
- Produces:
  ```ts
  export interface CadenceRow { personId: string; name: string; cadenceDays: number; daysSinceLast1on1: number | null; next1on1: IsoDateTime | null; status: "on_track" | "due" | "overdue" | "no_history"; daysSinceLastNote: number | null; noteBand: "fresh" | "aging" | "stale" | "none" }
  export function cadence(i: { now: Date; timeZone: string; people: Person[]; oneOnOnes: Meeting[]; lastNoteAt: Map<string, IsoDateTime> }): CadenceRow[];
  ```
- **Rows:** active `direct_report`s only. `cadenceDays` defaults to 14 when `oneOnOneCadenceDays` is null.
- **1:1 status:**
  - `on_track` if days ≤ cadence;
  - `due` if ≤ 1.5 × cadence;
  - otherwise `overdue`.
  - A next 1:1 that's already scheduled within the cadence keeps the row `on_track`.
- **Note band:** `fresh` 0–7 days, `aging` 8–14, `stale` ≥ 15, `none` if there are no notes.
- Sort order: `overdue` first, then most days.
- Op: `cadence.get → CadenceRow[]`.
- **Widget:** one row per report showing name, a status pill, `12d since 1:1 · next Thu`, and a note-band dot. Clicking a row opens the person.

- [ ] **Step 1: Write the failing tests.**
  - 20 days on a 14-day cadence → `due`.
  - 22 days → `overdue`.
  - 20 days, but a 1:1 scheduled tomorrow → `on_track`.
  - Never met → `no_history`.
  - A note 9 days ago → `aging`.
  - Stakeholders are excluded.
  - The widget renders the overdue row first.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-40): people cadence widget`.

**Acceptance:** At a glance, the manager sees who they owe time to. No per-person performance signal is shown.

---

### Task P1-41: Notifications

**Files:** `extension/src/notify/{scheduler.ts,rules.ts,index.ts}` + tests.

**Interfaces:**
- Consumes:
  - `settings.get` (`notifications`, `eodNudgeTime`, `workWeek`, `displayTimeZone`; P1-05);
  - `today.get` (P1-10) and `connectors.list` (P1-12);
  - the `sync.status` events;
  - `openView` (P1-28).
- Produces `export function dueNotifications(i: { now: Date; profile: Profile; today: Today; connectors: ConnectorStatus[]; sent: Set<string> }): { key: string; message: string; action?: { label: string; command: string; args?: unknown[] } }[]`. It's a pure function, and the scheduler calls it every 60 s.
- **Rules.** Each `key` fires at most once:

  | Rule | Key | Fires | Message (exact copy) | Action |
  |---|---|---|---|---|
  | Meeting soon | `meeting:<id>` | `meetingLeadMinutes` before a confirmed, not-declined meeting | `<title> in 10 min — prep ready` / `— prep needed` / no suffix when nothing is linked | `Open prep` |
  | Morning digest | `digest:<date>` | `morningDigestTime`, work days only | `3 due today · first meeting 9:30am` | `Open dashboard` |
  | Wrap nudge | `wrap:<date>` | `eodNudgeTime`, work days only | `Wrap up your day?` | `Open` |
  | Connector trouble | `conn:<id>:<date>` | a connector enters `error` or `offline` | `Calendar offline — check your network or VPN` (or the error message) | — |

- **Suppression:** quiet hours suppress everything, as do the per-type `enabled` flags. `sent` persists in `context.globalState` per day.

- [ ] **Step 1: Write the failing tests** (pure `dueNotifications` with fixed clocks).
  - A meeting at 10:00 with a 10-min lead → fires at 09:50, not at 09:49.
  - The same key isn't repeated.
  - The digest doesn't fire on Saturday.
  - Quiet hours 19:00–08:00 suppress a 07:55 meeting reminder.
  - An `offline` connector produces the VPN message once per day.
  - A declined meeting never fires.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The scheduler uses `vscode.window.showInformationMessage` and runs actions via `vscode.commands.executeCommand`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-41): local notifications`.

**Acceptance:** Notifications are helpful, never repeated, and fully controllable. Nothing is sent outside VS Code.

---

### Task P1-42: Automatic daily backups

**Files:** `service/src/backup-scheduler.ts`, `service/src/main.ts` (start it) + test.

**Interfaces:**
- Consumes: `Db.backup` (P0-10) and the data paths.
- Produces `export function startBackupScheduler(deps: { db: Db; dataDir: string; clock: Clock; log: Logger; keep?: number }): { stop(): void; runNow(): Promise<string> }`.
- **Schedule:** on service start, and every 6 h, check whether today's backup exists. If not, write `<dataDir>/backups/daily-YYYY-MM-DD.db`.
- **Rotation:** keep the newest `keep` (default 7) `daily-*` files. `pre-*` migration backups are never rotated away automatically.
- **Status:** `health.checks` (P1-36) shows the last backup date when present.

- [ ] **Step 1: Write the failing tests** (fake clock, temp dir).
  - A first start creates today's file.
  - A second start on the same day does nothing.
  - After 9 simulated days, 7 `daily-*` files remain.
  - `pre-*` files are untouched.
  - The backup file opens with `openDb` and has the same row counts.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-42): automatic daily backups with rotation`.

**Acceptance:** A week of restorable snapshots always exists, without the user doing anything.

---

### Task P1-43: "Go to…" quick pick

**Files:** `core/src/search/quick.ts`, `api-contract/src/ops/search-quick.ts`, `service/src/handlers/search-quick.ts`, `extension/src/commands/goTo.ts` + tests.

**Interfaces:**
- Consumes: the repos from P1-01, P1-02 and P1-04 (goals included), plus `openView` (P1-28).
- Produces:
  - `search.quick { query: string; limit?: number } → { kind: "person" | "meeting" | "commitment" | "goal"; id: string; label: string; detail: string }[]` (default limit 20);
  - the command `emos.goTo` (`cmd/ctrl+alt+g`), a QuickPick grouped by kind with live querying.
- **Scope:** people (name, aliases, handles), meetings within ±30 days (title), active, snoozed and proposed commitments (title), and active goals (title, slug).
- **Matching:** case- and accent-insensitive, prefix matches ranked above substring matches, ties broken by recency.
- **Details:** for a meeting, `Tue Oct 20 · 1:00pm`; for a commitment, `due Fri · @Sam`.

- [ ] **Step 1: Write the failing tests.**
  - `"zoe"` finds `Zoë Quinn`.
  - `"road"` ranks the meeting "Roadmap review" (prefix) above "Q4 roadmap" (substring).
  - A meeting from 40 days ago isn't returned.
  - Dropped commitments aren't returned.
  - Selecting an item calls `openView` with the right kind and id.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with SQL `LIKE` over normalised columns. Add a migration `p1-43_search_norm.sql` with normalised-name columns or indexes if needed.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(p1-43): go to quick pick`.

**Acceptance:** Any person, meeting, commitment or goal is reachable in under three keystrokes plus a name.

---

### Task P1-33: Phase 1 end-to-end synthetic test + dogfood checklist

**Files:** `test/e2e/phase1.test.ts`, `docs/plans/phase-1-dogfood.md`.

**Interfaces:**
- Consumes everything above.

- [ ] **Step 1: Write the e2e test.** On a temp data dir:
  1. `startService`;
  2. `import.apply` on the P1-16 fixture (self `Morgan Lee`, fixed clock `2026-10-20`); `proposals.decide` keeps all;
  3. `connectors.configure("calendar", ics: fixtures/calendar/sample.ics)`, then `connectors.sync`;
  4. `today.get` for a fixed date.

  Assert:
  - the meetings on the timeline match the ICS;
  - the top 5 has why chips;
  - `waitingOn` contains the imported `owed_to_me` item;
  - `prep.get` for the 1:1 returns last notes;
  - the MCP `get_person` returns open items;
  - `wrap.apply` completes one item and `today.get` shows progress `1/5`;
  - an MCP `ingest_items` of a synthetic transcript attaches it to the matching meeting, and a `propose_commitment` appears in `proposals.list`.
- [ ] **Step 2: Run `npx vitest run test/e2e`.** Expected: PASS on both OS jobs.
- [ ] **Step 3: Write `phase-1-dogfood.md`.** It's an owner checklist (with checkboxes) covering:
  - real import dry run and apply;
  - review;
  - real calendar connected;
  - a morning plan for 5 consecutive work days;
  - quick-capture usage;
  - Claude Code `claude mcp add` and a "what do I owe <name>?" query;
  - a "pain points" log feeding the Phase 2 plan.
- [ ] **Step 4: Commit** `test(p1-33): phase 1 end-to-end and dogfood checklist`.

**Acceptance (the Phase 1 done criterion):**
- The e2e test is green in CI.
- *(owner, after merge)* The owner has completed the dogfood checklist, planning every morning in EM OS for a week, including `/emos-capture` pulling Slack saved items and reminders.


---

## Commitment-first additions (2026-10-24)

### Task P1-44: Minimal commitment loop UI

**Dependencies:** P1-01, P1-02, P1-03, P1-05. This is deliberately independent of P1-10 and P1-23.

**Files:** `packages/extension/src/commitments-alpha/` (new UI and tests), plus the minimum command/registration files required to expose this view. If a shared existing file or contract must change outside this boundary, stop and request owner approval of the Files list; do not bypass the agent protocol.

**Interfaces:** Consume existing `commitments.list|get|create|update|complete|snooze|drop|reopen`, `commitments.quickCapture` and `people.resolve` operations. Do not change their schemas. Render two separate lists, `mine` and `owed_to_me`, with due/overdue, snooze, source and audit affordances. Quick capture must handle `needs_person` without guessing. Keep the UI accessible by keyboard and usable without a calendar or connector.

**Steps:**
- [ ] Add tests for empty state, create, ambiguous person, edit, complete, snooze, drop, reopen and both directions.
- [ ] Implement the smallest functional VS Code view/command surface, using the existing extension RPC bridge and API.
- [ ] Verify source/audit display and absence of silent state changes; no new autonomous writes.
- [ ] Run `npm run ci`; owner verifies the five-workday dogfood checklist after merge.
- [ ] Document reusable components for P1-28 and the future dashboard.

**Acceptance:** The owner can manage both directions of commitments end-to-end before the calendar/dashboard is built. Manual dogfood observations are recorded without real work content in the public repo.

### Task P1-45: Follow-up semantics tests and model review

**Dependencies:** P1-02.

**Files:** `packages/core/src/commitments/follow-up-scenarios.test.ts`, `docs/plans/commitment-follow-up-review.md` (new). No schema or API changes in this task.

**Steps:**
- [ ] Write synthetic scenarios: promise vs intention; undated promise; repeat reminder without duplication; incomplete delivery; deadline renegotiation with original promise retained; trigger-based obligation; a completed commitment resurfacing in sync.
- [ ] Mark each scenario as supported, unsupported or requiring a product decision. Tests for existing behavior should pass; unresolved behavior must be explicitly documented rather than forced into an invented contract.
- [ ] Review whether `audit_events` is sufficient for user-visible follow-up interactions. If not, propose a distinct interaction/event entity, lifecycle, provenance and deduplication rules.
- [ ] If changes cross an accepted ADR, write a proposed superseding ADR in a separate owner-reviewed change; do not rewrite an accepted ADR.

**Acceptance:** A concise gap analysis with reproducible tests and an explicit owner decision list; no premature implementation of a new domain model.

### Task P1-46: Pasted-text commitment extraction spike

**Dependencies:** P1-02, P1-04. **Marker:** spike (experiment, not production integration).

**Files:** `spikes/p1-46/` (synthetic corpus, runner, labelled evaluation and report); append a dated spike result to `docs/adr/0007-commitment-pipeline-triage.md` only after owner review and in accordance with the ADR protocol.

**Steps:**
- [ ] Build a labelled synthetic set with explicit promises, requests, intentions, quoted historical statements, cancellations, ambiguous owners, duplicates, due-date changes and partial completions.
- [ ] Compare structured model extraction against the labelled set; require source-item IDs and exact supporting spans, and flag uncertain owner/due-date inference.
- [ ] Evaluate precision, recall, duplicate rate, triage time and false-completion rate separately; report counts and examples, not just percentages.
- [ ] Show proposals for human accept/edit/merge/reject; do not auto-activate or contact external systems.
- [ ] Report privacy constraints, cost/latency and recommended changes, if any, for the owner's decision.

**Acceptance:** Reproducible synthetic evaluation and honest results. Any production pipeline or new contract requires its own planned task and appropriate ADR review.
