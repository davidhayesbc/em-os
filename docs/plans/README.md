# EM OS implementation plans

| Plan | Phase | Spec |
|---|---|---|
| [phase-0-foundations.md](phase-0-foundations.md) | 0: foundations + spikes | [PRODUCT_SPEC.md](../PRODUCT_SPEC.md) §12, ADRs 0001–0006, 0010 |
| [phase-1-daily-driver.md](phase-1-daily-driver.md) | 1: daily driver | [PRODUCT_SPEC.md](../PRODUCT_SPEC.md) §§5, 7, 10–12, ADRs 0001–0013 |

Each plan opens with a **task board**: one checkbox line per task. The task sections below it hold the detail and their own step checkboxes.

## How a coding agent works a task

1. **Pick.** Choose an unclaimed board line whose `deps` are all `[x]`. A task marked *spike* or *manual* needs the owner's machine and real accounts; leave those to the owner unless told otherwise.
2. **Claim.** In one commit on `main` (or the integration branch), edit the board line to replace `claim: —` with `claim: <agent-id> · <branch>`, and push. If the push conflicts, someone else claimed first, so re-pick. Branch name: `<task-id-lowercase>-<slug>`, e.g. `p0-08-api-contract`.
3. **Read** the task section, the plan's *Global Constraints* and *Review Focus*, and the spec/ADR sections the task cites. The **Interfaces** block is the contract with neighbouring tasks. Don't rename anything in it. If it's wrong, stop and raise it in the PR description instead of improvising.
4. **Build** the steps in order (TDD: failing test → implement → passing test). Tick each step `- [x]` in your branch as you go.
5. **Stay in your files.** Only create or modify the files listed under **Files**. Files marked *(append-only)* are shared registries: add your lines, don't reorder or edit others', and rebase on conflict.
6. **Finish.** Open one PR per task. The PR must:
   - tick the task's board line `[x]`;
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
