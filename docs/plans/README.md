# EM OS implementation plans

**Start here.** The plan with status *in progress* is the current phase. Its **Task board**, near the top of the file, is the work queue.

| Plan | Phase | Status | Spec |
|---|---|---|---|
| [phase-0-foundations.md](phase-0-foundations.md) | 0: foundations + spikes | **complete**, except 3 owner spikes (P0-04, P0-05, P0-06) | [PRODUCT_SPEC.md](../PRODUCT_SPEC.md) §12, ADRs 0001–0006, 0010 |
| [phase-1-daily-driver.md](phase-1-daily-driver.md) | 1: daily driver | **in progress**: start with P1-00 | [PRODUCT_SPEC.md](../PRODUCT_SPEC.md) §§5, 7, 10–12, ADRs 0001–0013 |

Phases 2–5 are described in [PRODUCT_SPEC.md §12](../PRODUCT_SPEC.md). Each gets its own `phase-N-*.md` plan, in this structure, before work starts.

Each plan opens with a **task board**: one checkbox line per task. The task sections below it hold the detail and their own step checkboxes.

## Task markers

| Marker | Where | Meaning | Who |
|---|---|---|---|
| `- [ ]` / `- [x]` | board line, step | open / done (merged) | whoever finishes the task ticks it, in the same PR |
| `claim: —` | board line | unclaimed | — |
| `claim: <agent-id> · <branch>` | board line | in progress | the claiming agent |
| `claim: done · <commit>` | board line | merged; set together with `[x]` | the finishing agent |
| `claim: owner` | board line | reserved for the human owner | owner only |
| `blocked: <reason>` | board line | can't proceed; needs a decision or a dependency | anyone sets it; the owner clears it |
| *manual* | board line and task title | needs the owner's machine, real accounts or judgement (e.g. MCP servers, Claude login, LLM gateway, publisher accounts) | owner only, unless the owner hands it to an agent |
| *spike* | board line and task title | an experiment whose output is a recorded decision in an ADR, not product code | an agent, unless also *manual* |
| *manual + CI* | board line and task title | mixed: the owner does the account steps; an agent may do the steps not marked "(owner)" | both |
| *(owner, after merge)* | acceptance bullet | verified by the owner on real accounts after merge; not required for the PR | owner |
| *(append-only)* | Files list | shared registry file: add your lines, never reorder or edit others' | everyone |

## Owner work outstanding

Agents never pick these. They're listed here so nobody waits on them unknowingly.

- **P0-04:** direct MCP client against the owner's MCP servers. Its result decides the transport for P1-13 and P1-14. Until it's recorded in ADR 0005, those tasks build against the fixture invoker only.
- **P0-05:** headless `claude -p` recipe plus a terms check (ADR 0006). Needed before Phase 2 model jobs.
- **P0-06:** LiteLLM gateway discovery and structured output (ADR 0006). Needed before Phase 2 model routing.
- **P1-37 steps 1 and 4:** Marketplace and Open VSX accounts, and the first pre-release publish.
- **ADR 0001 Verification, Windows desktop:** check Defender and SmartScreen on a real Windows machine.
- **Every *(owner, after merge)* acceptance bullet** in the current plan.

## How a coding agent works a task

1. **Pick.** Choose an unclaimed board line whose `deps` are all `[x]`. A task marked *spike* or *manual* needs the owner's machine and real accounts; leave those to the owner unless told otherwise.
2. **Claim.** In one commit on `main` (or the integration branch), edit the board line to replace `claim: —` with `claim: <agent-id> · <branch>`, and push. If the push conflicts, someone else claimed first, so re-pick. Branch name: `<task-id-lowercase>-<slug>`, e.g. `p0-08-api-contract`.
3. **Read** the task section, the plan's *Global Constraints* and *Review Focus*, and the spec/ADR sections the task cites. The **Interfaces** block is the contract with neighbouring tasks. Don't rename anything in it. If it's wrong, stop and raise it in the PR description instead of improvising.
4. **Build** the steps in order (TDD: failing test → implement → passing test). Tick each step `- [x]` in your branch as you go.
5. **Stay in your files.** Only create or modify the files listed under **Files**. Files marked *(append-only)* are shared registries: add your lines, don't reorder or edit others', and rebase on conflict.
6. **Finish.** Open one PR per task. The PR must:
   - tick the task's board line `[x]`, set `claim: done · <merge commit>`, and tick every step checkbox in the task's section;
   - pass CI on both OS jobs;
   - meet every **Acceptance** bullet, except bullets marked *(owner, after merge)*. The owner verifies those on real accounts after merge, and a failure becomes a new bug task;
   - contain synthetic data only.

   A task is *done* when its PR merges.
7. **Blocked?** Add `blocked: <reason>` to the board line and stop. Don't work around a missing dependency by writing its code.

## Conventions every task follows

- **Packages:** `packages/<name>`, npm name `@emos/<name>`. Code goes in `src/`, tests sit beside the code as `*.test.ts`.
- **New packages:** the first task that creates files in a package also creates its `package.json`, `tsconfig.json` and `src/index.ts`, copying the P0-01 package template. That's implicitly part of its Files list. `src/index.ts` is append-only for everyone after that.
- **Schema changes:** add `packages/store-sqlite/src/migrations/<task-id>_<area>.sql` and append it to `migrations/index.ts`. Never edit a merged migration.
- **Commits:** Conventional Commits with the task id in the scope, e.g. `feat(p1-06): rank time-critical items first`.
- **Spike results** go in the cited ADR under a `## Spike result (YYYY-MM-DD)` heading. Results contain no work data, real names or org-specific values.
- **No real data, ever.** Fixtures use synthetic people (Alex Rivera, Sam Chen, Jordan Patel, Priya Nair, …) and the `example.com` / `example.org` domains.
