# Expected import output for `packages/importer-em-template/fixtures/workspace`

Import assumptions:

- Import date: **2026-10-20**.
- Self person: **Morgan Lee** (the fixture user, not represented by a People file).
- Fixture mtimes are pinned in `mtimes.json`; files changed within the 30-day activation window are treated as recently touched.

## Inventory checklist

The fixture exercises every mapping row of the `em-template` format notes:

- `People/*.md` and `Stakeholders/*.md` → person + identity; one human (Sam Chen) appears in both and is merged.
- People notes (Running contribution, Growth goals, Comms, Feedback) and Stakeholder notes (Context, Six-month rollup, Relationship) → `person_note` (`people_sensitive`).
- `1-1s/<First-Last>/<date>.md` → meeting + source_item, with Career / Wellbeing / Feedback / For-People sections as `people_sensitive` chunks.
- `Daily-Logs/Standups/*.md` → standup meetings, including a `-multifecta` suffix variant.
- `Daily-Logs/<date>.md` → source_item, with `<!-- BEGIN auto-today -->…<!-- END auto-today -->` and `<!-- BEGIN auto-scheduled -->…<!-- END auto-scheduled -->` sentinel content skipped and `## Meeting —` sections preserved as meeting notes.
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

Counts below were recomputed from the fixture tree. Each row states its derivation so a reviewer can re-add the numbers.

| Entity | Count | Derivation |
|---|---|---|
| persons | 5 | 3 People files + 3 Stakeholder files − 1 duplicate (Sam Chen) = 5 humans: Alex Rivera, Sam Chen, Zoë Quinn, Jordan Patel, Priya Nair. |
| identities | 18 | Per-file handles/aliases after merging Sam Chen: Alex (3), Sam (6), Zoë (3), Jordan (3), Priya (3) = 3 + 6 + 3 + 3 + 3. |
| person_notes | 31 | People/Stakeholder sensitive sections/dated bullets (13): Alex 3 + Sam 3 + Zoë 3 + Jordan 2 + Priya 1 + Stakeholder Sam 1; 1:1 sensitive sections (16) = 4 meetings × 4 sections; Team-Health named notes (2) = Alex + Zoë. 13 + 16 + 2 = 31. |
| growth_goals (People) | 2 | `People/sam-chen.md` and `People/zoe-quinn.md`; `People/alex-rivera.md` intentionally omits the section. |
| growth_goals (My-Growth) | 1 | `My-Growth/brag-doc.md` line "Improve delegation in Q4." |
| meetings | 7 | 4 one-on-ones + 3 standups. |
| source_items | 16 | 4 one-on-ones + 3 standups + 3 daily logs + 1 weekly summary + 1 report + 1 decision + 3 daily-log meeting sections. |
| commitments (active) | 22 | 34 parseable open checkboxes − 12 dropped = 22 active. Active items are user-owned or `!waiting-*` and have a due date, priority or urgency tag, or their source file mtime is within 30 days of 2026-10-20. |
| commitments (done) | 1 | Only one `[x]` line exists: `Todos.md` "explore AI tooling". |
| commitments (dropped) | 12 | 10 other-owned items (Alex 5, Sam 2, Zoë 2, Priya 1) + 1 placeholder `them:` item in `Todos.md` + 1 stale undated user-owned item in `1-1s/Alex-Rivera/2026-10-13.md` (pinned mtime 2026-09-01, outside the 30-day window). |
| risks | 2 | R1 and R2 from the risk register. |
| risk_linked_notes | 1 | Dated corroboration on R1. |
| goals | 1 | `Workstreams/api-cleanup.md`. |
| decisions | 1 | `Decisions/001-use-sqlite.md`. |
| references / glossary | 2 | `Systems/inventory.md` and `Acronyms.md`. |
| accomplishments | 2 | From `My-Growth/brag-doc.md`: shipped local-first sync, mentored two interns. |
| documents | 2 | Brag-doc rubric + Senior Engineer JD rubric. |
| drafts | 2 | Weekly summary draft history + report draft history. |

## Person merge

- **Sam Chen** is represented by both `People/sam-chen.md` and `Stakeholders/sam-chen.md`; the importer merges them into a single `person` record with origins `people` and `stakeholder`.

## Unknown pronouns

- **Alex Rivera** has `**Pronouns:** <!-- TODO: confirm -->` → imported as `null` (rendered "they/them").

## Todo activation summary

Activation rule: `[x]` → done; `[ ]` owned by or owed to the user → active only if it has a due date, priority/urgency tag, or a source file mtime within 30 days of 2026-10-20; everything else → dropped.

| Category | Count | Explanation |
|---|---|---|
| Active (proposed) open todos | 22 | User-owned or `!waiting-*` items with due/priority/urgency, or from recently pinned files. |
| Done todos | 1 | The single `[x]` line in `Todos.md`. |
| Dropped / archived todos | 12 | 10 other-owned items + 1 placeholder-`them` item + 1 stale undated user-owned item in `1-1s/Alex-Rivera/2026-10-13.md` (mtime pinned to 2026-09-01). |
| Unparseable todo line | 1 | `Todos.md` line 17; reported in the dry-run, not imported as a commitment. |
| Generated skipped lines | 2 | `TODO.md` task A and task B; not imported. |
