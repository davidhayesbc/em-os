# Importer notes: `em-template` workspace (one-time, personal)

These are the format notes for a one-time importer that reads a Markdown/Foam workspace in the [`em-template`](https://github.com/davidhayesbc/em-template) layout. It follows [ADR 0011](../adr/0011-one-time-importers.md): dry run first, read-only on the source, dates preserved, idempotent re-runs only to fix a bad import. It's an ephemeral importer, so once it's been used successfully, this file and the importer package can be deleted.

Tests use a **synthetic** workspace fixture in this layout. No real content ever enters the repo.

## Mapping

| Source | Becomes |
|---|---|
| `People/*.md` (direct reports) and `Stakeholders/*.md` | `person` — one per human; merged when both files exist — plus `identity` (chat/code-host handles from the Comms/Relationship sections, aliases from frontmatter). Pronouns come from the `**Pronouns:**` Basics field or the Relationship bullet; `<!-- TODO: confirm -->` → null (unknown). |
| People `## Running contribution notes`, Stakeholders `## Context on them`, `## Six-month rollup …` | `person_note` (`people_sensitive`, origin `import`), one per dated bullet |
| People `## Growth goals` | person growth goals (`people_sensitive`) |
| People `## Comms preferences`, `## How they like feedback`, intro sections | `person_note` (`people_sensitive`) |
| `1-1s/<First-Last>/<date>.md` | `meeting` (`one_on_one`, dated from the filename) + `source_item` (note). Sections *Career / growth*, *Wellbeing check*, *Feedback given/received* and *For their People/ file* become `people_sensitive` chunks; the rest are `normal`. *Action items* go through the activation rule. |
| `Daily-Logs/Standups/*.md` (including suffixed variants) | `meeting` (`standup`) + `source_item`. Action items stay on the meeting unless owned by or owed to the user. |
| `Daily-Logs/<date>.md` | `source_item` (note). `## Meeting — <title> (<date>)` sections become meeting notes. Sentinel blocks `<!-- BEGIN auto-today -->…<!-- END auto-today -->` and `auto-scheduled` are skipped (generated content). |
| Checkbox lines anywhere | `commitment` (see below) |
| `Risks/risk-register.md` (table) | `risk`. Inline bold dated corroborations are split into dated linked notes. |
| `Workstreams/*.md` | `goal` (kind `project`) or a workstream tag, chosen in the dry run |
| `Decisions/*.md` | `decision` + `source_item` |
| `Systems/inventory.md`, `Acronyms.md` | reference records / glossary (`normal`) |
| `My-Growth/` (brag doc, development plan, promotion path) | `accomplishment` (self), personal growth goals, and a rubric `document` |
| `JobDescriptions/` | rubric `document`s for promotion packages |
| `Weekly-Summaries/`, `Reports/` | `source_item` (note) + `draft` history |
| `Team-Health/` | `person_note`s (`people_sensitive`) where a person is named, otherwise a note |
| Last-line marker `<!-- gemini-thread-id:<id> · fetched:… -->` | stored on the `source_item` so the meeting-notes connector never re-imports the same note |
| Generated files (`TODO.md`, `Leadership-Dashboard.*`), `.claude/`, `.github/`, `bin/`, templates, READMEs | skipped |

## Todo grammar

- **Line:** `- [ ]` / `- [x]` + `YYYY-MM-DD — (Owner[ + Owner]) text` (owner-first order also accepted) + tags + `<!-- id:xxxxxx -->`.
- **Owner:**
  - an absent owner means the user;
  - `[[People/X|X]]` or a bare name resolves to a person;
  - placeholder owners (`them`, `me`) resolve from the file's subject.
- **Tags:**
  - `!p0`–`!p3` → priority;
  - `!now`/`!next`/`!soon` → urgency;
  - `!later`/`!someday` → deferred;
  - `!blocked`, `!waiting-<who>` → `owed_to_me` with a counterpart;
  - `!YYYY-MM-DD` → due;
  - `#ws:<slug>` → goal/workstream;
  - `#supersedes:<id>` → close the referenced item as merged;
  - other `#tags` → tags.
- **Ids:** a line may carry two id markers (a readable id and a 6-char id). Key on the 6-char id, and keep the other as an alias for cross-references.

**Activation rule:**

- `[x]` → `done` (history).
- `[ ]` → `active` only if both hold:
  - it's owned by or owed to the user;
  - it has a due date, priority or urgency tag, *or* its source file changed in the last 30 days.
- All other open items → `dropped` (`drop_reason = archived_on_import`), still searchable and restorable.

The active set is confirmed on the import review screen.

## Expected drift to tolerate

- Headings that vary by pronoun or name ("What he owns", "What I owe <Name>").
- Missing or extra sections (e.g. "Signals to fold forward").
- Free-text `source:` fields in thread markers.
- Old-style link-reference definitions.

Report anything unparseable in the dry run.

## Config proposed in the dry run

- Team roster and handles.
- Code-host repos.
- Meeting title patterns for 1:1s and standups.
- Display time zone.
- Workstream slugs → goals.
- Calibration freshness bands, if wanted as a profile reminder.

The user confirms each one. Nothing is hardcoded.
