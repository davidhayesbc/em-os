# Expected import output for `packages/importer-em-template/fixtures/workspace`

Import assumptions:

- Import date: **2026-10-20**.
- Self person: **Morgan Lee** (the fixture user, not represented by a People file).
- Fixture mtimes are pinned in `mtimes.json`; files changed within the 30-day activation window are treated as recently touched.

## Inventory checklist

The fixture exercises every mapping row of the `em-template` format notes:

- `People/*.md` and `Stakeholders/*.md` → person + identity; one human (Sam Chen) appears in both and is merged.
- People notes (Running contribution, Comms preferences, How they like feedback) and Stakeholder notes (Context on them, Six-month rollup) → `person_note` (`people_sensitive`), one per bullet in those sections.
- People `## Growth goals` → person growth goals, one per bullet.
- `1-1s/<First-Last>/<date>.md` → meeting + source_item, with Career / Wellbeing / Feedback / For-People sections as `people_sensitive` chunks.
- `Daily-Logs/Standups/*.md` → standup meetings, including a `-multifecta` suffix variant.
- `Daily-Logs/<date>.md` → source_item, with `<!-- BEGIN auto-today -->…<!-- END auto-today -->` and `<!-- BEGIN auto-scheduled -->…<!-- END auto-scheduled -->` sentinel content skipped and each `## Meeting —` section preserved as a meeting note.
- Checkbox lines anywhere → commitment; the `Todos.md` file exercises every grammar tag plus a line with two id markers.
- `Risks/risk-register.md` → risk rows, including an inline bold dated corroboration that becomes a linked note.
- `Workstreams/*.md` → goal/workstream.
- `Decisions/*.md` → decision + source_item.
- `Systems/inventory.md` and `Acronyms.md` → reference / glossary records.
- `My-Growth/brag-doc.md` → one `accomplishment` per dated bullet, one personal growth goal per bullet under Growth goals / Development plan, and a rubric document.
- `JobDescriptions/*.md` → rubric document.
- `Weekly-Summaries/` and `Reports/` → source_item + draft history.
- `Team-Health/` → `person_note` where a person is named.
- Last-line `<!-- gemini-thread-id:... · fetched:... -->` marker → stored on the source_item.
- Generated `TODO.md` is skipped.
- Drift: one CRLF file, one missing standard section, one unparseable todo line.

## Entity counts

Counts below were recomputed from the fixture tree under the P1-18…P1-22 interfaces. Each row states one unit and its derivation so a reviewer can re-add the numbers; changing any count makes the count-derivation test fail.

| Entity | Count | Derivation |
|---|---|---|
| persons | 5 | 3 People files + 3 Stakeholder files − 1 duplicate (Sam Chen) = 5 humans: Alex Rivera, Sam Chen, Zoë Quinn, Jordan Patel, Priya Nair. |
| identities | 18 | Per-file handles/aliases after merging Sam Chen: Alex (3), Sam (6), Zoë (3), Jordan (3), Priya (3). |
| person_notes | 22 | P1-18 bullets: Alex 5 (Running 1 + Comms 3 + Feedback 1) + Sam 5 + Zoë 5 + Jordan 2 (Context + Six-month rollup) + Priya 1 (Six-month rollup) + Stakeholder Sam 2 (Context + Six-month rollup) = 20; Team-Health named notes (Alex + Zoë) = 2. 20 + 2 = 22. |
| growth_goals (People) | 4 | Goal bullets under `## Growth goals` in People files: Sam 2 + Zoë 2. |
| growth_goals (My-Growth) | 2 | Goal bullets in `My-Growth/brag-doc.md`: Growth goals 1 + Development plan 1. |
| meetings | 10 | 4 one-on-ones + 3 standups + 3 daily-log `## Meeting —` sections. |
| source_items | 16 | 4 one-on-ones + 3 standups + 3 daily logs + 1 weekly summary + 1 report + 1 decision + 3 daily-log meeting sections. |
| commitments (proposed) | 26 | Self-owned or `owed_to_me` open checkboxes with a due date, priority/urgency tag, or a source file mtime within 30 days of 2026-10-20. |
| commitments (archived) | 1 | Stale undated user-owned item in `1-1s/Alex-Rivera/2026-10-13.md` (pinned mtime 2026-09-01). |
| commitments (done) | 1 | Only one `[x]` line exists: `Todos.md` "explore AI tooling". |
| commitments (skipped_not_mine) | 7 | Other-owned open checkboxes in 1:1/standup files that are not `!waiting-*`/`!blocked` and are not in a self file. |
| risks | 2 | R1 and R2 from the risk register. |
| risk_linked_notes | 1 | Dated corroboration on R1. |
| goals | 1 | `Workstreams/api-cleanup.md`. |
| decisions | 1 | `Decisions/001-use-sqlite.md`. |
| references / glossary | 2 | `Systems/inventory.md` and `Acronyms.md`. |
| accomplishments | 2 | Dated bullets in `My-Growth/brag-doc.md`: 2026-08-20 local-first sync, 2026-09-10 intern mentorship. |
| documents | 2 | Brag-doc rubric + Senior Engineer JD rubric. |
| drafts | 2 | Weekly summary draft history + report draft history. |
| unparseable todo line | 1 | `Todos.md` line 17; reported in the dry-run, not imported as a commitment. |
| generated skipped lines | 2 | `TODO.md` task A and task B; not imported. |

## Person merge

- **Sam Chen** is represented by both `People/sam-chen.md` and `Stakeholders/sam-chen.md`; the importer merges them into a single `person` record with origins `people` and `stakeholder`.

## Unknown pronouns

- **Alex Rivera** has `**Pronouns:** <!-- TODO: confirm -->` → imported as `null` (rendered "they/them").

## Todo activation summary

Activation rule: `[x]` → done; `[ ]` owned by or owed to the user → `proposed` only if it has a due date, priority/urgency tag, or a source file mtime within 30 days of 2026-10-20; otherwise `archived`; other-owned items in non-self files that are not `!waiting-*`/`!blocked` → `skipped_not_mine`.

| Category | Count | Explanation |
|---|---|---|
| Proposed | 26 | User-owned or `owed_to_me` items with due/priority/urgency, or from recently pinned files. |
| Done | 1 | The single `[x]` line in `Todos.md`. |
| Archived | 1 | One stale undated user-owned item in `1-1s/Alex-Rivera/2026-10-13.md` (mtime pinned to 2026-09-01). |
| Skipped not mine | 7 | Other-owned items in 1:1/standup files that the user is not waiting on. |
| Unparseable | 1 | `Todos.md` line 17; reported in the dry-run, not imported as a commitment. |
| Generated skipped | 2 | `TODO.md` task A and task B; not imported. |
