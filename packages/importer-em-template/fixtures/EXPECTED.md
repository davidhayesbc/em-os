# Expected import output for `packages/importer-em-template/fixtures/workspace`

Import assumptions:

- Import date: **2026-10-20**.
- Self person: **Morgan Lee** (the fixture user, not represented by a People file).
- Fixture mtimes are pinned in `mtimes.json`; files changed within the 30-day activation window are treated as recently touched.

## Inventory checklist

The fixture exercises every row of the `em-template` mapping notes:

- `People/*.md` and `Stakeholders/*.md` → person + identity; one human (Sam Chen) appears in both and is merged.
- People notes (Running contribution, Growth goals, Comms, Feedback) and Stakeholder notes (Context, Six-month rollup, Relationship) → `person_note` (`people_sensitive`).
- `1-1s/<First-Last>/<date>.md` → meeting + source_item, with Career / Wellbeing / Feedback / For-People sections as `people_sensitive` chunks.
- `Daily-Logs/Standups/*.md` → standup meetings, including a `-multifecta` suffix variant.
- `Daily-Logs/<date>.md` → source_item, with `auto-today` sentinel content skipped and `## Meeting —` sections preserved as meeting notes.
- Checkbox lines anywhere → commitment; the `Todos.md` file exercises every grammar tag plus a line with two id markers.
- `Risks/risk-register.md` → risk rows, including an inline bold dated corroboration that becomes a linked note.
- `Workstreams/*.md` → goal/workstream.
- `Decisions/*.md` → decision + source_item.
- `Systems/inventory.md` and `Acronyms.md` → reference / glossary records.
- `My-Growth/brag-doc.md` → accomplishment + personal growth goal + rubric document.
- `JobDescriptions/*.md` → rubric document.
- `Weekly-Summaries/` and `Reports/` → source_item + draft history.
- `Team-Health/` → `person_note` where a person is named.
- Last-line `<!-- gemini-thread-id:... · fetched:... -->` marker → stored on the source_item.
- Generated `TODO.md` is skipped.
- Drift: one CRLF file, one missing standard section, one unparseable todo line.

## Entity counts

| Entity | Count | Notes |
|---|---|---|
| persons | 5 | Alex Rivera, Sam Chen, Zoë Quinn, Jordan Patel, Priya Nair |
| identities | 9 | aliases + chat/code-host handles + email (after merging Sam Chen) |
| person_notes | 34 | People/Stakeholder notes + 1:1 sensitive sections + Team-Health named note |
| growth_goals (People) | 3 | one per People file |
| growth_goals (My-Growth) | 1 | from `brag-doc.md` |
| meetings | 7 | 4 one-on-ones + 3 standups |
| source_items | 19 | one per 1:1, standup, daily log, weekly summary, report, decision, and daily-log meeting section |
| commitments (active) | 14 | open items owned by or waiting on the user, with recent mtimes |
| commitments (done) | 2 | `[x]` items |
| commitments (dropped) | 8 | open items owned by others or unparseable line |
| risks | 2 | R1 and R2 from the risk register |
| risk_linked_notes | 1 | dated corroboration on R1 |
| goals | 1 | `Workstreams/api-cleanup.md` |
| decisions | 1 | `Decisions/001-use-sqlite.md` |
| references / glossary | 2 | `Systems/inventory.md` and `Acronyms.md` |
| accomplishments | 2 | from `My-Growth/brag-doc.md` |
| documents | 2 | brag-doc rubric + Senior Engineer JD rubric |
| drafts | 2 | weekly summary + report draft histories |

## Person merge

- **Sam Chen** is represented by both `People/sam-chen.md` and `Stakeholders/sam-chen.md`; the importer merges them into a single `person` record with origins `people` and `stakeholder`.

## Unknown pronouns

- **Alex Rivera** has `**Pronouns:** <!-- TODO: confirm -->` → imported as `null` (rendered "they/them").

## Todo activation summary

Assuming all fixture files carrying user-owned or user-owed open todos have mtimes within 30 days of 2026-10-20:

- Active (proposed) open todos: 14
- Done todos: 2
- Dropped / archived todos: 8
- Unparseable todo line: 1 (reported in the dry-run, not imported as a commitment)
