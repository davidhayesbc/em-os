# Commitment Alpha dogfood checklist

This checklist supports the P1-44 Alpha A manual commitment loop. Complete the setup with synthetic data, then capture real observations during five consecutive workdays. **Do not commit real work content to the public repo.** Record only counts, timing, anonymised friction notes and reusable-component guidance.

## Synthetic setup (before real use)

Use the dashboard in a fresh dev data dir. Create the same synthetic people each run so observations are reproducible:

1. `Self`: Morgan Lee (`per_self`).
2. `Sam Chen` (`per_sam`), peer.
3. `Alex Rivera` (`per_alex`) and `Alex Chen` (`per_alex2`), peers with the same first name.
4. `Jordan Patel` (`per_jordan`), direct report.

Create initial commitments from the dashboard:

- `Send quarterly review @Sam !fri` — `mine`, due date set.
- `wait @Jordan the hiring plan !mon` — `owed_to_me`.
- `Ask @Alex for feedback` — leave ambiguous, select `Alex Rivera` explicitly.
- `Plan the roadmap update` — no due date (test no-date support).

## Five-workday checklist *(owner, after merge)*

Use the dashboard each morning before email/Slack. For each day, record:

- [ ] **Capture time** (seconds from opening the dashboard to seeing the new item in the list).
- [ ] **Friction** (anything that made you stop or think).
- [ ] **Failure** (capture rejected, ambiguous person unresolved, action refused by the service).
- [ ] **Follow-up gap** (something you expected to do but could not, e.g. edit time, set recurrence, attach a source item).

### Day 1

- [ ] Open dashboard; confirm both lists load.
- [ ] Capture one `mine` commitment with a due date.
- [ ] Capture one `owed_to_me` commitment without a due date.
- [ ] Select an item and read its source/audit panel.

### Day 2

- [ ] Review overdue/snoozed states from Day 1.
- [ ] Snooze one item.
- [ ] Edit a due date.

### Day 3

- [ ] Complete one active commitment.
- [ ] Drop one commitment with a reason.
- [ ] Verify completed/dropped items are visible and can be reopened.

### Day 4

- [ ] Reopen one dropped/completed item.
- [ ] Capture a commitment whose person is ambiguous; resolve explicitly.
- [ ] Note keyboard-only usage: can you tab through lists, select, capture and submit?

### Day 5

- [ ] Capture a commitment while offline (service unavailable), then retry after reconnect.
- [ ] Export or screenshot only synthetic/timing notes; no real work content.
- [ ] Record the top friction item for Phase 2 planning.

## Measurements to record

| Day | Capture time (s) | Friction | Failure | Follow-up gap |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

## Component reuse guidance for P1-28

The P1-44 implementation intentionally keeps components generic so P1-28 can reuse them in the full dashboard:

- `CommitmentList` accepts `direction`, `items`, `error`, `selectedId`, `onSelect` and `onRetry`. Pass a filtered or ranked subset from P1-28.
- `CommitmentDetail` accepts `commitmentId`, `onMutated` and `onClose`. It loads its own detail and listens for `items.changed` events, so it works inside any container.
- `QuickCapture` accepts only `onCreated`. It uses existing `commitments.quickCapture`; no new RPC contract is required.
- `useCommitments` and `useCommitment` are reusable hooks that subscribe to `items.changed` events and refresh automatically.
- Styling lives in `theme.css` under the `.commitments-*` namespace. P1-28 can import the same rules or override them without adding a second dashboard framework.

## Owner-only notes

- Real work data must stay on the owner&apos;s machine and must not appear in this public repo.
- If a real observation reveals a bug, file a new task with synthetic reproduction steps.
- Do not modify this file to claim completion until the five-workday checklist is actually finished.
