# AGENTS.md — working on EM OS

This file is for coding agents (Claude Code, Codex, Copilot, Cursor, …) and the people directing them. Read it before you change anything. `CLAUDE.md` imports it.

## 1. What this repo is

EM OS is a local-first tool for engineering managers. It has a background **service** (Node 24 + SQLite) and **clients**: a VS Code extension, a CLI, and an MCP server for other agents. This is a **public, organisation-agnostic** repository.

| You need | Read |
|---|---|
| What we're building and why | [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — the binding authority |
| Why it's built this way | [`docs/adr/`](docs/adr/README.md) — architecture decision records |
| **What to work on next** | [`docs/plans/README.md`](docs/plans/README.md), then the current phase's task board |
| How to build, run, debug and test | [`docs/DEVELOPING.md`](docs/DEVELOPING.md) |

**Authority order:** spec → ADRs → plan → existing code. When they conflict, the higher one wins. Raise the conflict in your PR instead of silently picking one.

## 2. Finding and doing work

1. **Open [`docs/plans/README.md`](docs/plans/README.md).** It lists every plan with its status, the task-marker legend, and the claim → build → PR protocol. Follow that protocol exactly.
2. **Pick a task** from the current phase's **Task board**. The current phase is the first plan whose status is not *complete*. The task must be:
   - unclaimed (`claim: —`);
   - not marked *manual* or *spike*;
   - one whose `deps` are all `[x]`.
3. **Read only what you need:**
   - the task's section;
   - the plan's **Global Constraints** and **Review Focus**;
   - the spec and ADR sections the task cites.

   The task's **Interfaces** block is a contract with neighbouring tasks. Never rename anything in it. If it's wrong, stop and say so in the PR.
4. **Stay inside the task's Files list.** Files marked *(append-only)* are shared registries. Add your lines and rebase on conflict.
5. **Definition of done:**
   - every **Acceptance** bullet holds, except bullets marked *(owner, after merge)*;
   - `npm run ci` is green;
   - the PR is merged;
   - the board line and all of the task's step checkboxes are ticked `[x]`, with `claim:` set to `done · <merge commit>`.

   **Tick the boxes in the same PR.** A stale board blocks other agents, because they can only pick tasks whose deps are `[x]`.
6. **Blocked?** Set `blocked: <reason>` on the board line and stop. Don't build another task's work to unblock yourself.

### Work only the owner can do

These markers are defined in [`docs/plans/README.md`](docs/plans/README.md#task-markers). Never attempt work that carries them unless the owner explicitly hands it to you:

- *manual* or *spike, manual* tasks;
- `claim: owner` board lines;
- *(owner, after merge)* acceptance bullets.

They need the owner's real accounts, machine or judgement: MCP servers, Claude login, LLM gateway, publisher accounts, a week of dogfooding.

## 3. Hard rules

These are not negotiable, and each is enforced by CI or review.

1. **Public repo, no organisation specifics.**
   - Never commit employer names, internal tool or server names, internal hostnames, registry mirrors, workspace ids, real people, real emails or real work content.
   - Fixtures and tests use synthetic people (Alex Rivera, Sam Chen, Jordan Patel, Priya Nair, Zoë Quinn, …) and `example.com` / `example.org`.
   - `npm run check:fixtures` scans fixtures and test files, and CI runs gitleaks.
   - Org-specific integrations, such as an internal MCP gateway adapter, live in **private repos** as external plugins (ADR 0005, `@emos/plugin-api`).
2. **No secrets anywhere** in the repo, logs, fixtures or API responses. Secrets go through the `SecretStore` port into the OS keychain. Logs contain ids and counts only.
3. **`@emos/core` stays pure.** It must not import I/O, network, process, database, MCP or LLM libraries. A Biome rule enforces this.
4. **Never edit a merged migration.** Add `packages/store-sqlite/src/migrations/<task-id>_<area>.sql` and append it to the registry. Then regenerate `sql.generated.ts` (the build does this, and a drift test checks it).
5. **Store timestamps** as UTC via `toDbInstant()`. Store date-only values as `YYYY-MM-DD` plus an IANA zone.
6. **Tests never touch the real OS keychain, the real data dir or the network:**
   - use temp dirs and the in-memory secret store;
   - the real-keychain test is opt-in (`EMOS_TEST_KEYCHAIN=1`);
   - `EMOS_SECRET_STORE=memory` is a **test/dev-only** switch, honoured only with a matching `EMOS_DATA_DIR`.
7. **The lockfile holds no registry URLs.** `.npmrc` sets `omit-lockfile-registry-resolved=true`. Don't change registry config, and don't commit `resolved` URLs.
8. **Models never write to external systems.** Model-made items go to triage as proposals (spec §§7, 10).
9. **Pronouns:** never infer them from a name. Unknown means `null`, rendered as "they/them" (spec §5.5).

## 4. Commands

```sh
npm ci                     # install (Node 24, see .nvmrc)
npm run ci                 # lint + fixture scan + docs protocol check + build + bundle check + typecheck + tests (what CI runs)
npm run check:docs         # ADR format/index + plan boards (ids, deps, claims, ticks, manual markers) — run after editing docs/
npx vitest run packages/<pkg>        # one package's tests
npm run smoke              # package the VSIX for this OS and run it in a real VS Code (slow; downloads VS Code once)
npm run package            # build the VSIX (add `-- --target win32-x64` to cross-build)
```

The build order is computed from package dependencies (`scripts/workspaces.mjs`). Run `npm run build` before tests that rely on another package's `dist/`.

## 5. Conventions

- **Packages:** `packages/<name>` as `@emos/<name>`, ESM, TypeScript strict, with tests beside the code (`*.test.ts`). A new package copies the `packages/core` template, and the first task in a package creates its scaffolding.
- **Commits:** Conventional Commits with the task id as scope, e.g. `feat(p1-06): rank time-critical items first`. One PR per task.
- **Commit trailer:** end commit messages with the co-author trailer your tooling requires.
- **Decisions:** if you make a design decision the spec and plan don't cover, record it:
  - a choice within the ADR's boundary goes in the PR description;
  - one that changes a boundary needs an ADR. See below.
- **Spikes and experiments** go under `spikes/<id>/`. They're throwaway unless the task says to keep a dev tool, as with `spikes/s5-ollama/bench.ts`. Results go into the ADR, never the raw data.

## 6. Architecture decision records (ADR protocol)

Full rules: [`docs/adr/README.md`](docs/adr/README.md). Template: [`docs/adr/TEMPLATE.md`](docs/adr/TEMPLATE.md).

**Write a new ADR, or supersede one, when you:**
- add or replace a runtime dependency, storage engine, transport, protocol or security control;
- change a package boundary, port or public contract (API ops, MCP tools, plugin API, schema conventions);
- deviate from an existing ADR.

**Don't write one** for choices inside an existing ADR's boundary. Note those in the PR.

**Format:** numbered `NNNN-kebab-title.md`, using the next free number. Each ADR has the sections Status, Date, Spec, Context, Decision, Alternatives considered and Consequences, and appears in the index table in `docs/adr/README.md`.

**Accepted ADRs are not rewritten.** To change a decision, add a new ADR that supersedes the old one, and set the old one's Status to `Superseded by NNNN`. Allowed additions to an accepted ADR:
- dated `## Spike result (YYYY-MM-DD)` or `## Verification (YYYY-MM-DD)` sections;
- clarifications that don't change the decision.

**Evidence is honest.** Write "pending", "inferred" or "not tested" when that's the truth. CI-backed claims cite the workflow run.

## 7. Before you open a PR

The PR template (`.github/pull_request_template.md`) has this checklist:
- the task id is in the title;
- the board is ticked;
- `npm run ci` is green;
- the data is synthetic;
- no org specifics;
- the ADR is updated if a decision changed;
- *(owner, after merge)* items are listed.

## 8. Things that will surprise you

- **The service outlives VS Code.** After rebuilding, run `emos service stop` (or let the version-aware launcher replace it) before testing again.
- **The service refuses a data dir inside a git checkout.** The dev host uses `~/.emos-dev-data`.
- **The webview has no network access.** All data goes through the extension's RPC bridge, and the token never reaches the webview.
- **Two webview import rules:**
  - Webview code imports `@emos/api-contract/bridge` (zod-free), never the package root. `npm run check:bundles` fails on `eval`/`Function` or remote URLs in the bundles.
  - Some ops are host-only and are refused from the webview, e.g. `service.shutdown` and `backup.create` (P1-00).
