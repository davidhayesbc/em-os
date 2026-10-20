-- 0001_initial: the Phase 1 schema.
--
-- Conventions (ADR 0002, ADR 0004):
-- * Columns mirror the @emos/api-contract entity fields in snake_case. Exceptions:
--   meetings.start/end are start_at/end_at (END is an SQL keyword); a meeting's attendees live in
--   meeting_attendees; the sourceItemIds of risks, decisions and accomplishments live in
--   record_sources; commitments.due_date is a generated copy of due.date for range queries.
-- * Every table is STRICT, so a value of the wrong storage class is rejected.
-- * Ids are TEXT (prefixed ULIDs from @emos/core). Booleans are INTEGER 0/1.
-- * Timestamps are canonical UTC ISO strings, exactly `YYYY-MM-DDTHH:MM:SS.sssZ` (what
--   Date#toISOString produces), so lexical order is time order. Local dates are `YYYY-MM-DD`.
-- * Arrays and objects are JSON text, checked with json_valid/json_type.
-- * Enum CHECKs mirror the contract enums. Widening one needs a table rebuild migration; migrate()
--   runs with foreign_keys OFF and a foreign_key_check before commit, so FKs never cascade during
--   the rebuild. Recipe for rebuilding table T (see migrations/index.ts; tested in migrate.test.ts):
--     1. If T is risks, decisions, documents or accomplishments: DROP TRIGGER
--        record_sources_entity_insert and record_sources_entity_update first. They name T, and
--        ALTER TABLE ... RENAME fails while a trigger refers to a missing table.
--     2. CREATE TABLE T_new (...full new definition...) STRICT;
--        INSERT INTO T_new SELECT ... FROM T; DROP TABLE T; ALTER TABLE T_new RENAME TO T;
--     3. DROP TABLE T also dropped its indexes and triggers: recreate every one, including
--        T_occurred_idx and, for the four tables above, T_delete_sources (the polymorphic
--        record_sources cascade, which no FK check can catch if it is missing).
--     4. Recreate the two record_sources_entity_* triggers from step 1, verbatim.
--     Check: SELECT type, name FROM sqlite_master is the same before and after.
-- * Every dated table (one that has occurred_at) has captured_at, updated_at, retention_state and
--   an index on (occurred_at, retention_state) (ADR 0004).
-- * Foreign keys:
--   - references to people are ON DELETE RESTRICT, required or not: people are archived, never
--     deleted, and a merge must re-point every reference explicitly rather than lose "who";
--   - other required references are RESTRICT;
--   - optional references to non-person records (goal, meeting, author identity) are SET NULL;
--   - join tables (commitment_sources, meeting_notes, meeting_attendees, record_sources) CASCADE
--     from both ends. record_sources is polymorphic, so triggers stand in for its entity FK.
-- * audit_events has no foreign key: the audit trail outlives the record it describes.

CREATE TABLE schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL CHECK (applied_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;

-- People ---------------------------------------------------------------------------------------

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  relationship TEXT NOT NULL
    CHECK (relationship IN ('self', 'direct_report', 'manager', 'peer', 'stakeholder', 'other')),
  pronouns TEXT, -- NULL = unknown; never inferred
  aliases TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases) AND json_type(aliases) = 'array'),
  role TEXT,
  time_zone TEXT, -- IANA zone
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  one_on_one_cadence_days INTEGER CHECK (one_on_one_cadence_days > 0),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
CREATE INDEX people_occurred_idx ON people (occurred_at, retention_state);
-- There is exactly one user per database.
CREATE UNIQUE INDEX people_single_self_idx ON people (relationship) WHERE relationship = 'self';

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
  source TEXT NOT NULL
    CHECK (source IN ('chat', 'code_host', 'email', 'calendar', 'tickets', 'docs', 'other')),
  handle TEXT NOT NULL COLLATE NOCASE, -- handle or external id; ASCII case-insensitive
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged')),
  UNIQUE (source, handle)
) STRICT;
CREATE INDEX identities_occurred_idx ON identities (occurred_at, retention_state);
CREATE INDEX identities_person_idx ON identities (person_id);

CREATE TABLE person_notes (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
  text TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  source_url TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'people_sensitive'
    CHECK (sensitivity IN ('normal', 'people_sensitive', 'private')),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'import', 'mcp')),
  review_state TEXT NOT NULL DEFAULT 'accepted' CHECK (review_state IN ('proposed', 'accepted')),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
CREATE INDEX person_notes_occurred_idx ON person_notes (occurred_at, retention_state);
CREATE INDEX person_notes_person_idx ON person_notes (person_id, occurred_at);

-- Goals ----------------------------------------------------------------------------------------

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE, -- resolves `#ws:` tags; NULLs are not unique-checked
  subject_person_id TEXT NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
  horizon TEXT NOT NULL CHECK (horizon IN ('quarter', 'half', 'ongoing')),
  kind TEXT NOT NULL CHECK (kind IN ('team', 'project', 'personal_growth')),
  status TEXT NOT NULL CHECK (status IN ('active', 'achieved', 'dropped')),
  target_date TEXT CHECK (target_date GLOB '????-??-??'),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'people_sensitive', 'private')),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
CREATE INDEX goals_occurred_idx ON goals (occurred_at, retention_state);
CREATE INDEX goals_subject_idx ON goals (subject_person_id);

-- Source items and meetings --------------------------------------------------------------------

CREATE TABLE source_items (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('message', 'thread', 'email', 'event', 'transcript', 'doc_section', 'pr', 'ticket', 'note')
  ),
  origin TEXT NOT NULL CHECK (origin IN ('connector', 'import', 'mcp_ingest', 'manual')),
  url TEXT,
  author_identity_id TEXT REFERENCES identities (id) ON DELETE SET NULL,
  text TEXT NOT NULL, -- emptied when purged; the row stays as a tombstone (ADR 0004)
  content_hash TEXT NOT NULL,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'people_sensitive', 'private')),
  sections TEXT CHECK (json_valid(sections) AND json_type(sections) = 'array'),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged')),
  UNIQUE (connector_id, external_id)
) STRICT;
CREATE INDEX source_items_occurred_idx ON source_items (occurred_at, retention_state);
CREATE INDEX source_items_author_idx ON source_items (author_identity_id);

CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL CHECK (start_at GLOB '????-??-??T??:??:??.???Z'),
  end_at TEXT NOT NULL CHECK (end_at GLOB '????-??-??T??:??:??.???Z'),
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  self_response TEXT CHECK (self_response IN ('accepted', 'tentative', 'declined', 'needs_action')),
  classification TEXT NOT NULL
    CHECK (classification IN ('one_on_one', 'standup', 'team', 'external', 'other')),
  classification_source TEXT NOT NULL DEFAULT 'auto'
    CHECK (classification_source IN ('auto', 'user')),
  person_id TEXT REFERENCES people (id) ON DELETE RESTRICT, -- the other party of a 1:1
  action_items TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(action_items) AND json_type(action_items) = 'array'),
  url TEXT,
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged')),
  UNIQUE (connector_id, external_id)
) STRICT;
CREATE INDEX meetings_occurred_idx ON meetings (occurred_at, retention_state);
CREATE INDEX meetings_start_idx ON meetings (start_at);
CREATE INDEX meetings_person_idx ON meetings (person_id, start_at);

-- Meeting.attendees, in order. Owned by the meeting.
CREATE TABLE meeting_attendees (
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  identity_id TEXT REFERENCES identities (id) ON DELETE SET NULL,
  person_id TEXT REFERENCES people (id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  PRIMARY KEY (meeting_id, position)
) STRICT;
CREATE INDEX meeting_attendees_person_idx ON meeting_attendees (person_id);
CREATE INDEX meeting_attendees_identity_idx ON meeting_attendees (identity_id);

-- Notes and transcripts attached to a meeting.
CREATE TABLE meeting_notes (
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  source_item_id TEXT NOT NULL REFERENCES source_items (id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, source_item_id)
) STRICT;
CREATE INDEX meeting_notes_source_idx ON meeting_notes (source_item_id);

-- Commitments ----------------------------------------------------------------------------------

CREATE TABLE commitments (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK (direction IN ('mine', 'owed_to_me')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'snoozed', 'done', 'dropped')),
  drop_reason TEXT CHECK (drop_reason IN ('user', 'stale', 'archived_on_import', 'merged')),
  urgency TEXT CHECK (urgency IN ('now', 'next', 'soon', 'later', 'someday')),
  priority INTEGER CHECK (priority BETWEEN 0 AND 3), -- p0..p3
  due TEXT CHECK (json_valid(due) AND json_type(due) = 'object'), -- { date, time, timeZone }
  due_date TEXT GENERATED ALWAYS AS (json_extract(due, '$.date')) VIRTUAL,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  created_by TEXT NOT NULL CHECK (created_by IN ('user', 'extractor', 'import', 'mcp')),
  owner_id TEXT NOT NULL REFERENCES people (id) ON DELETE RESTRICT,
  counterpart_id TEXT REFERENCES people (id) ON DELETE RESTRICT,
  goal_id TEXT REFERENCES goals (id) ON DELETE SET NULL,
  meeting_id TEXT REFERENCES meetings (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  effort_minutes REAL,
  snoozed_until TEXT CHECK (snoozed_until GLOB '????-??-??T??:??:??.???Z'),
  completed_at TEXT CHECK (completed_at GLOB '????-??-??T??:??:??.???Z'),
  recurrence TEXT CHECK (json_valid(recurrence) AND json_type(recurrence) = 'object'),
  series_id TEXT, -- shared by all occurrences of a recurring item
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged')),
  CHECK (drop_reason IS NULL OR status = 'dropped')
) STRICT;
CREATE INDEX commitments_occurred_idx ON commitments (occurred_at, retention_state);
CREATE INDEX commitments_status_idx ON commitments (status, direction);
CREATE INDEX commitments_due_idx ON commitments (due_date);
CREATE INDEX commitments_owner_idx ON commitments (owner_id);
CREATE INDEX commitments_counterpart_idx ON commitments (counterpart_id);
CREATE INDEX commitments_goal_idx ON commitments (goal_id);
CREATE INDEX commitments_meeting_idx ON commitments (meeting_id);
CREATE INDEX commitments_series_idx ON commitments (series_id);

CREATE TABLE commitment_sources (
  commitment_id TEXT NOT NULL REFERENCES commitments (id) ON DELETE CASCADE,
  source_item_id TEXT NOT NULL REFERENCES source_items (id) ON DELETE CASCADE,
  PRIMARY KEY (commitment_id, source_item_id)
) STRICT;
CREATE INDEX commitment_sources_source_idx ON commitment_sources (source_item_id);

-- Risks, decisions, documents, accomplishments -------------------------------------------------

CREATE TABLE risks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'mitigated', 'closed')),
  owner_id TEXT REFERENCES people (id) ON DELETE RESTRICT,
  links TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links) AND json_type(links) = 'array'),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
CREATE INDEX risks_occurred_idx ON risks (occurred_at, retention_state);
CREATE INDEX risks_owner_idx ON risks (owner_id);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'decided', 'superseded')),
  owner_id TEXT REFERENCES people (id) ON DELETE RESTRICT,
  links TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links) AND json_type(links) = 'array'),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
CREATE INDEX decisions_occurred_idx ON decisions (occurred_at, retention_state);
CREATE INDEX decisions_owner_idx ON decisions (owner_id);

-- Content lives in doc_section source items, each with its own date.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_person_id TEXT REFERENCES people (id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('brag_doc', 'design_doc', 'rubric', 'other')),
  shared_with_me INTEGER NOT NULL DEFAULT 0 CHECK (shared_with_me IN (0, 1)),
  last_modified TEXT CHECK (last_modified GLOB '????-??-??T??:??:??.???Z'),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
CREATE INDEX documents_occurred_idx ON documents (occurred_at, retention_state);
CREATE INDEX documents_owner_idx ON documents (owner_person_id);

CREATE TABLE accomplishments (
  id TEXT PRIMARY KEY,
  subject_person_id TEXT NOT NULL REFERENCES people (id) ON DELETE RESTRICT, -- self or a report
  summary TEXT NOT NULL,
  impact TEXT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal', 'people_sensitive', 'private')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted')),
  occurred_at TEXT NOT NULL CHECK (occurred_at GLOB '????-??-??T??:??:??.???Z'),
  captured_at TEXT NOT NULL CHECK (captured_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  retention_state TEXT NOT NULL DEFAULT 'active'
    CHECK (retention_state IN ('active', 'archived', 'excluded', 'purged'))
) STRICT;
CREATE INDEX accomplishments_occurred_idx ON accomplishments (occurred_at, retention_state);
CREATE INDEX accomplishments_subject_idx ON accomplishments (subject_person_id, occurred_at);

-- Corroborating source items for risks, decisions, documents and accomplishments
-- (their `sourceItemIds`). Polymorphic, so the entity side is enforced by the triggers below;
-- an unknown entity falls through to ELSE 0 and is rejected by the CHECK.
CREATE TABLE record_sources (
  entity TEXT NOT NULL CHECK (entity IN ('risk', 'decision', 'document', 'accomplishment')),
  entity_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL REFERENCES source_items (id) ON DELETE CASCADE,
  PRIMARY KEY (entity, entity_id, source_item_id)
) STRICT;
CREATE INDEX record_sources_source_idx ON record_sources (source_item_id);

CREATE TRIGGER record_sources_entity_insert BEFORE INSERT ON record_sources
WHEN CASE NEW.entity
  WHEN 'risk' THEN NOT EXISTS (SELECT 1 FROM risks WHERE id = NEW.entity_id)
  WHEN 'decision' THEN NOT EXISTS (SELECT 1 FROM decisions WHERE id = NEW.entity_id)
  WHEN 'document' THEN NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.entity_id)
  WHEN 'accomplishment' THEN NOT EXISTS (SELECT 1 FROM accomplishments WHERE id = NEW.entity_id)
  ELSE 0
END
BEGIN
  SELECT RAISE(ABORT, 'record_sources: entity_id does not exist');
END;

CREATE TRIGGER record_sources_entity_update BEFORE UPDATE OF entity, entity_id ON record_sources
WHEN CASE NEW.entity
  WHEN 'risk' THEN NOT EXISTS (SELECT 1 FROM risks WHERE id = NEW.entity_id)
  WHEN 'decision' THEN NOT EXISTS (SELECT 1 FROM decisions WHERE id = NEW.entity_id)
  WHEN 'document' THEN NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.entity_id)
  WHEN 'accomplishment' THEN NOT EXISTS (SELECT 1 FROM accomplishments WHERE id = NEW.entity_id)
  ELSE 0
END
BEGIN
  SELECT RAISE(ABORT, 'record_sources: entity_id does not exist');
END;

CREATE TRIGGER risks_delete_sources AFTER DELETE ON risks BEGIN
  DELETE FROM record_sources WHERE entity = 'risk' AND entity_id = OLD.id;
END;
CREATE TRIGGER decisions_delete_sources AFTER DELETE ON decisions BEGIN
  DELETE FROM record_sources WHERE entity = 'decision' AND entity_id = OLD.id;
END;
CREATE TRIGGER documents_delete_sources AFTER DELETE ON documents BEGIN
  DELETE FROM record_sources WHERE entity = 'document' AND entity_id = OLD.id;
END;
CREATE TRIGGER accomplishments_delete_sources AFTER DELETE ON accomplishments BEGIN
  DELETE FROM record_sources WHERE entity = 'accomplishment' AND entity_id = OLD.id;
END;

-- Audit ----------------------------------------------------------------------------------------

-- One row per mutation of any entity. No foreign key: the trail outlives the record.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'import', 'system', 'mcp')),
  at TEXT NOT NULL CHECK (at GLOB '????-??-??T??:??:??.???Z'),
  note TEXT,
  diff TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(diff) AND json_type(diff) = 'object')
) STRICT;
CREATE INDEX audit_events_entity_idx ON audit_events (entity, entity_id, at);

-- Settings, layouts, day plans -----------------------------------------------------------------

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;

CREATE TABLE layouts (
  surface TEXT PRIMARY KEY,
  entries TEXT NOT NULL CHECK (json_valid(entries) AND json_type(entries) = 'array')
) STRICT;

-- The day's stable top list (P1-10).
CREATE TABLE day_plans (
  local_date TEXT PRIMARY KEY CHECK (local_date GLOB '????-??-??'),
  commitment_ids TEXT NOT NULL
    CHECK (json_valid(commitment_ids) AND json_type(commitment_ids) = 'array'),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;

-- Connectors and MCP clients -------------------------------------------------------------------

CREATE TABLE sync_state (
  connector_id TEXT PRIMARY KEY,
  cursor TEXT,
  state TEXT NOT NULL DEFAULT 'never'
    CHECK (state IN ('never', 'syncing', 'ok', 'offline', 'error')),
  last_attempt_at TEXT CHECK (last_attempt_at GLOB '????-??-??T??:??:??.???Z'),
  last_success_at TEXT CHECK (last_success_at GLOB '????-??-??T??:??:??.???Z'),
  last_error TEXT, -- message only, never content
  item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0)
) STRICT;

CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, -- unique among non-revoked clients (index below)
  token_hash TEXT NOT NULL UNIQUE, -- sha256 of the bearer token; the token itself is never stored
  allow_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (allow_sensitive IN (0, 1)),
  created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  revoked_at TEXT CHECK (revoked_at GLOB '????-??-??T??:??:??.???Z')
) STRICT;
-- Revoked rows stay for the audit trail, so a name can be reused once its client is revoked.
CREATE UNIQUE INDEX mcp_clients_live_name_idx ON mcp_clients (name) WHERE revoked_at IS NULL;

-- Importer idempotency (P1-17): one row per applied import unit.
CREATE TABLE import_keys (
  key TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL
) STRICT;
CREATE INDEX import_keys_entity_idx ON import_keys (entity, entity_id);
