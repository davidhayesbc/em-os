import { backup, DatabaseSync } from "node:sqlite";
import { chmod, mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { PullRequestRecord, Storage } from "./contracts.js";
import type { SlackPersistencePage } from "./slack-connector.js";
import { encryptBackupArtifact, decryptBackupArtifact, BackupEnvelopeError, BackupKeyUnavailableError, type BackupArtifact, type BackupKeySource, type EncryptedBackupEnvelope, recomputeHeaderAAD } from "./backup-envelope.js";

export const STORAGE_EXPORT_VERSION = 1 as const;
const ISO_UTC = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function parseEncryptedBackupEnvelope(serialized:string):EncryptedBackupEnvelope{
 try { return JSON.parse(serialized) as EncryptedBackupEnvelope; }
 catch(error){
  if(error instanceof SyntaxError||error instanceof TypeError) throw new BackupEnvelopeError("EnvelopeValidationError: envelope is not valid JSON");
  throw error;
 }
}

function normalizeReviewTitle(value: string): string {
 return value.toLowerCase().replace(/^[A-Z][A-Z0-9]+-\d+:\s*/i, "").replace(/\W+/g, " ").trim();
}

// Byte-for-byte schema shipped by commit 89c24b8d. Never edit this fixture;
// append a forward migration instead so stamped databases are not stranded.
export const HISTORICAL_V1_SCHEMA_SQL = `
CREATE TABLE people (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT,
 identities_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(identities_json)),
 identity_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(identity_confirmed IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (${ISO_UTC}), updated_at TEXT NOT NULL DEFAULT (${ISO_UTC})
) STRICT;
CREATE TABLE source_records (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_id TEXT NOT NULL, stable_url TEXT,
 occurred_at TEXT, observed_at TEXT NOT NULL, excerpt TEXT, content_hash TEXT NOT NULL,
 classification TEXT NOT NULL, last_seen_at TEXT NOT NULL, retention_until TEXT,
 deleted_at TEXT, deletion_reason TEXT,
 created_at TEXT NOT NULL DEFAULT (${ISO_UTC}), updated_at TEXT NOT NULL DEFAULT (${ISO_UTC}),
 UNIQUE(provider, source_id),
 CHECK(occurred_at IS NULL OR occurred_at GLOB '????-??-??T??:??:??*Z'),
 CHECK(observed_at GLOB '????-??-??T??:??:??*Z'),
 CHECK(last_seen_at GLOB '????-??-??T??:??:??*Z')
) STRICT;
CREATE INDEX source_records_seen_idx ON source_records(provider, last_seen_at);
CREATE INDEX source_records_retention_idx ON source_records(retention_until) WHERE deleted_at IS NULL;
CREATE VIRTUAL TABLE source_records_fts USING fts5(excerpt, content='source_records', content_rowid='rowid');
CREATE TRIGGER source_records_ai AFTER INSERT ON source_records WHEN new.deleted_at IS NULL BEGIN
 INSERT INTO source_records_fts(rowid,excerpt) VALUES(new.rowid,new.excerpt);
END;
CREATE TRIGGER source_records_ad AFTER DELETE ON source_records BEGIN
 INSERT INTO source_records_fts(source_records_fts,rowid,excerpt) VALUES('delete',old.rowid,old.excerpt);
END;
CREATE TRIGGER source_records_au AFTER UPDATE OF excerpt,deleted_at ON source_records BEGIN
 INSERT INTO source_records_fts(source_records_fts,rowid,excerpt) SELECT 'delete',old.rowid,old.excerpt WHERE old.deleted_at IS NULL;
 INSERT INTO source_records_fts(rowid,excerpt) SELECT new.rowid,new.excerpt WHERE new.deleted_at IS NULL;
END;
CREATE TABLE sync_cursors (
 connector TEXT NOT NULL, scope TEXT NOT NULL, cursor TEXT, watermark TEXT,
 last_success_at TEXT, last_error TEXT, fetched_count INTEGER NOT NULL DEFAULT 0 CHECK(fetched_count >= 0),
 updated_at TEXT NOT NULL DEFAULT (${ISO_UTC}), PRIMARY KEY(connector, scope)
) STRICT;
CREATE TABLE prs (
 id TEXT PRIMARY KEY, source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 provider TEXT NOT NULL, repository TEXT NOT NULL, source_id TEXT NOT NULL,
 author TEXT NOT NULL, reviewers_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(reviewers_json)),
 title TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT, updated_at TEXT NOT NULL, merged_at TEXT,
 is_draft INTEGER NOT NULL CHECK(is_draft IN (0,1)), ci_status TEXT NOT NULL,
 review_requested INTEGER NOT NULL CHECK(review_requested IN (0,1)), last_relevant_activity_at TEXT,
 state TEXT NOT NULL DEFAULT 'open', UNIQUE(provider, repository, source_id)
) STRICT;
CREATE INDEX prs_attention_idx ON prs(state,is_draft,review_requested,updated_at);
CREATE TABLE initiatives (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT, deadline TEXT, dependencies_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(dependencies_json)),
 status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (${ISO_UTC}), updated_at TEXT NOT NULL DEFAULT (${ISO_UTC})
) STRICT;
CREATE TABLE action_items (
 id TEXT PRIMARY KEY, owner_person_id TEXT REFERENCES people(id) ON DELETE SET NULL, description TEXT NOT NULL,
 due_at TEXT, due_timezone TEXT, status TEXT NOT NULL DEFAULT 'open', review_state TEXT NOT NULL DEFAULT 'proposed' CHECK(review_state IN ('proposed','approved','rejected','superseded')),
 snoozed_until TEXT, suppressed INTEGER NOT NULL DEFAULT 0 CHECK(suppressed IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (${ISO_UTC}), updated_at TEXT NOT NULL DEFAULT (${ISO_UTC})
) STRICT;
CREATE TRIGGER action_items_initial_review_guard BEFORE INSERT ON action_items WHEN new.review_state <> 'proposed' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE INDEX action_items_due_idx ON action_items(status,due_at);
CREATE TABLE action_item_sources (
 action_item_id TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
 source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 anchor TEXT, PRIMARY KEY(action_item_id,source_record_id)
) STRICT;
CREATE TABLE evidence (
 id TEXT PRIMARY KEY, subject_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
 observation TEXT NOT NULL, impact TEXT, competency_tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(competency_tags_json)),
 author TEXT NOT NULL, approver TEXT, observed_at TEXT NOT NULL, interpretation TEXT, sensitivity TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','rejected','superseded')),
 supersedes_id TEXT REFERENCES evidence(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL DEFAULT (${ISO_UTC}), updated_at TEXT NOT NULL DEFAULT (${ISO_UTC})
) STRICT;
CREATE TRIGGER evidence_initial_review_guard BEFORE INSERT ON evidence WHEN new.status <> 'proposed' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE TABLE evidence_sources (
 evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
 source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 anchor TEXT, PRIMARY KEY(evidence_id,source_record_id)
) STRICT;
CREATE TABLE drafts (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, period TEXT NOT NULL, audience TEXT NOT NULL,
 input_record_ids_json TEXT NOT NULL CHECK(json_valid(input_record_ids_json)), model_route TEXT, model_version TEXT,
 file_path TEXT, generated_at TEXT NOT NULL, reviewer_state TEXT NOT NULL DEFAULT 'proposed' CHECK(reviewer_state IN ('proposed','approved','rejected','superseded')),
 cached_markdown TEXT, created_at TEXT NOT NULL DEFAULT (${ISO_UTC}), updated_at TEXT NOT NULL DEFAULT (${ISO_UTC})
) STRICT;
CREATE TRIGGER drafts_initial_review_guard BEFORE INSERT ON drafts WHEN new.reviewer_state <> 'proposed' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE TABLE draft_sources (
 draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
 source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 anchor TEXT, PRIMARY KEY(draft_id,source_record_id)
) STRICT;
CREATE TABLE review_audit (
 id INTEGER PRIMARY KEY, entity_type TEXT NOT NULL CHECK(entity_type IN ('action_item','evidence','draft')),
 entity_id TEXT NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL, actor TEXT NOT NULL,
 reason TEXT NOT NULL, changed_at TEXT NOT NULL
) STRICT;
CREATE INDEX review_audit_entity_idx ON review_audit(entity_type,entity_id,changed_at);
CREATE TRIGGER review_audit_no_update BEFORE UPDATE ON review_audit BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER review_audit_no_delete BEFORE DELETE ON review_audit BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER action_review_guard BEFORE UPDATE OF review_state ON action_items WHEN old.review_state <> new.review_state BEGIN
 SELECT CASE WHEN old.review_state <> 'proposed' THEN RAISE(ABORT,'terminal review state cannot transition') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM review_audit WHERE entity_type='action_item' AND entity_id=old.id AND from_state=old.review_state AND to_state=new.review_state) THEN RAISE(ABORT,'review transition requires audit') END;
END;
CREATE TRIGGER evidence_review_guard BEFORE UPDATE OF status ON evidence WHEN old.status <> new.status BEGIN
 SELECT CASE WHEN old.status <> 'proposed' THEN RAISE(ABORT,'terminal review state cannot transition') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM review_audit WHERE entity_type='evidence' AND entity_id=old.id AND from_state=old.status AND to_state=new.status) THEN RAISE(ABORT,'review transition requires audit') END;
END;
CREATE TRIGGER draft_review_guard BEFORE UPDATE OF reviewer_state ON drafts WHEN old.reviewer_state <> new.reviewer_state BEGIN
 SELECT CASE WHEN old.reviewer_state <> 'proposed' THEN RAISE(ABORT,'terminal review state cannot transition') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM review_audit WHERE entity_type='draft' AND entity_id=old.id AND from_state=old.reviewer_state AND to_state=new.reviewer_state) THEN RAISE(ABORT,'review transition requires audit') END;
END;
CREATE TABLE cache_entries (cache_key TEXT PRIMARY KEY, source_record_id TEXT REFERENCES source_records(id) ON DELETE CASCADE, value TEXT NOT NULL, expires_at TEXT) STRICT;
CREATE TABLE deletion_tombstones (
 provider TEXT NOT NULL, source_id TEXT NOT NULL, deleted_at TEXT NOT NULL, reason TEXT NOT NULL,
 content_hash TEXT NOT NULL, PRIMARY KEY(provider,source_id)
) STRICT;
`;

export const migrations = [
  { version: 1, sql: HISTORICAL_V1_SCHEMA_SQL },
  {
    version: 2,
    sql: `
DROP TRIGGER IF EXISTS action_review_guard;
DROP TRIGGER IF EXISTS evidence_review_guard;
DROP TRIGGER IF EXISTS draft_review_guard;
DROP TRIGGER IF EXISTS action_items_initial_review_guard;
DROP TRIGGER IF EXISTS evidence_initial_review_guard;
DROP TRIGGER IF EXISTS drafts_initial_review_guard;
DROP TRIGGER IF EXISTS review_audit_no_update;
DROP TRIGGER IF EXISTS review_audit_no_delete;
CREATE TRIGGER action_items_initial_review_guard BEFORE INSERT ON action_items WHEN new.review_state <> 'proposed' AND em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE TRIGGER evidence_initial_review_guard BEFORE INSERT ON evidence WHEN new.status <> 'proposed' AND em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE TRIGGER drafts_initial_review_guard BEFORE INSERT ON drafts WHEN new.reviewer_state <> 'proposed' AND em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE TRIGGER review_audit_no_update BEFORE UPDATE ON review_audit WHEN em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER review_audit_no_delete BEFORE DELETE ON review_audit WHEN em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER review_audit_no_insert BEFORE INSERT ON review_audit WHEN em_review_write_mode() NOT IN ('transition','import') BEGIN SELECT RAISE(ABORT,'review audit may only be written by storage API'); END;
CREATE TRIGGER action_review_guard BEFORE UPDATE OF review_state ON action_items WHEN old.review_state <> new.review_state BEGIN
 SELECT CASE WHEN em_review_write_mode() NOT IN ('transition','import') THEN RAISE(ABORT,'review transition requires storage API') END;
 SELECT CASE WHEN old.review_state <> 'proposed' AND em_review_write_mode() <> 'import' THEN RAISE(ABORT,'terminal review state cannot transition') END;
END;
CREATE TRIGGER evidence_review_guard BEFORE UPDATE OF status ON evidence WHEN old.status <> new.status BEGIN
 SELECT CASE WHEN em_review_write_mode() NOT IN ('transition','import') THEN RAISE(ABORT,'review transition requires storage API') END;
 SELECT CASE WHEN old.status <> 'proposed' AND em_review_write_mode() <> 'import' THEN RAISE(ABORT,'terminal review state cannot transition') END;
END;
CREATE TRIGGER draft_review_guard BEFORE UPDATE OF reviewer_state ON drafts WHEN old.reviewer_state <> new.reviewer_state BEGIN
 SELECT CASE WHEN em_review_write_mode() NOT IN ('transition','import') THEN RAISE(ABORT,'review transition requires storage API') END;
 SELECT CASE WHEN old.reviewer_state <> 'proposed' AND em_review_write_mode() <> 'import' THEN RAISE(ABORT,'terminal review state cannot transition') END;
END;
CREATE TRIGGER action_review_audit AFTER UPDATE OF review_state ON action_items WHEN old.review_state <> new.review_state AND em_review_write_mode()='transition' BEGIN
 INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('action_item',old.id,old.review_state,new.review_state,em_review_actor(),em_review_reason(),em_review_changed_at());
END;
CREATE TRIGGER evidence_review_audit AFTER UPDATE OF status ON evidence WHEN old.status <> new.status AND em_review_write_mode()='transition' BEGIN
 INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('evidence',old.id,old.status,new.status,em_review_actor(),em_review_reason(),em_review_changed_at());
END;
CREATE TRIGGER draft_review_audit AFTER UPDATE OF reviewer_state ON drafts WHEN old.reviewer_state <> new.reviewer_state AND em_review_write_mode()='transition' BEGIN
 INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('draft',old.id,old.reviewer_state,new.reviewer_state,em_review_actor(),em_review_reason(),em_review_changed_at());
END;
`},
  {
    version: 3,
    sql: `
-- Upgrade objects added after the immutable v1/v2 migrations shipped.
DROP TRIGGER IF EXISTS source_records_ad;
DROP TRIGGER IF EXISTS source_records_au;
DROP TRIGGER IF EXISTS review_audit_no_update;
DROP TRIGGER IF EXISTS review_audit_no_delete;
DROP TRIGGER IF EXISTS review_audit_no_insert;
CREATE TRIGGER source_records_ad AFTER DELETE ON source_records WHEN old.deleted_at IS NULL BEGIN
 INSERT INTO source_records_fts(source_records_fts,rowid,excerpt) VALUES('delete',old.rowid,old.excerpt);
END;
CREATE TRIGGER source_records_au AFTER UPDATE OF excerpt,deleted_at ON source_records BEGIN
 INSERT INTO source_records_fts(source_records_fts,rowid,excerpt) SELECT 'delete',old.rowid,old.excerpt WHERE old.deleted_at IS NULL;
 INSERT INTO source_records_fts(rowid,excerpt) SELECT new.rowid,new.excerpt WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER review_audit_no_update BEFORE UPDATE ON review_audit WHEN em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER review_audit_no_delete BEFORE DELETE ON review_audit WHEN em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER review_audit_no_insert BEFORE INSERT ON review_audit WHEN em_review_write_mode() NOT IN ('transition','import') BEGIN SELECT RAISE(ABORT,'review audit may only be written by storage API'); END;
CREATE INDEX IF NOT EXISTS prs_source_record_idx ON prs(source_record_id);
CREATE INDEX IF NOT EXISTS action_items_owner_idx ON action_items(owner_person_id);
CREATE INDEX IF NOT EXISTS action_item_sources_source_idx ON action_item_sources(source_record_id);
CREATE INDEX IF NOT EXISTS evidence_subject_idx ON evidence(subject_person_id);
CREATE INDEX IF NOT EXISTS evidence_supersedes_idx ON evidence(supersedes_id);
CREATE INDEX IF NOT EXISTS evidence_sources_source_idx ON evidence_sources(source_record_id);
CREATE INDEX IF NOT EXISTS draft_sources_source_idx ON draft_sources(source_record_id);
CREATE INDEX IF NOT EXISTS cache_entries_source_idx ON cache_entries(source_record_id);
ALTER TABLE deletion_tombstones RENAME TO deletion_tombstones_pre_v3;
CREATE TABLE deletion_tombstones (
 provider TEXT NOT NULL, source_id TEXT NOT NULL, deleted_at TEXT NOT NULL, reason TEXT NOT NULL,
 content_hash TEXT, PRIMARY KEY(provider,source_id)
) STRICT;
INSERT INTO deletion_tombstones(provider,source_id,deleted_at,reason,content_hash)
 SELECT provider,source_id,deleted_at,reason,content_hash FROM deletion_tombstones_pre_v3;
DROP TABLE deletion_tombstones_pre_v3;
`},
  {
    version: 4,
    sql: `
CREATE TABLE review_queue_proposals (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('action','decision','calendar-follow-up','jira-action')),
 description TEXT NOT NULL, source_record_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 source_context_json TEXT CHECK(json_valid(source_context_json)),
 source_links_json TEXT CHECK(json_valid(source_links_json)),
 occurred_at TEXT, retention_until TEXT,
 review_state TEXT NOT NULL DEFAULT 'proposed' CHECK(review_state IN ('proposed','approved','rejected')),
 created_at TEXT NOT NULL DEFAULT (${ISO_UTC}), updated_at TEXT NOT NULL DEFAULT (${ISO_UTC})
) STRICT;
CREATE INDEX review_queue_proposals_state_idx ON review_queue_proposals(review_state,kind,updated_at);
CREATE INDEX review_queue_proposals_source_idx ON review_queue_proposals(source_record_id) WHERE review_state='proposed';
CREATE TRIGGER review_queue_proposals_initial_guard BEFORE INSERT ON review_queue_proposals WHEN new.review_state <> 'proposed' BEGIN SELECT RAISE(ABORT,'review queue proposals must start proposed'); END;
CREATE TRIGGER review_queue_proposals_terminal_guard BEFORE UPDATE OF review_state ON review_queue_proposals WHEN old.review_state <> 'proposed' BEGIN SELECT RAISE(ABORT,'terminal review state cannot transition'); END;
CREATE TABLE proposal_review_audit (
 id INTEGER PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES review_queue_proposals(id) ON DELETE RESTRICT,
 from_state TEXT NOT NULL, to_state TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, changed_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER proposal_review_audit_no_update BEFORE UPDATE ON proposal_review_audit BEGIN SELECT RAISE(ABORT,'proposal review audit is append-only'); END;
CREATE TRIGGER proposal_review_audit_no_delete BEFORE DELETE ON proposal_review_audit BEGIN SELECT RAISE(ABORT,'proposal review audit is append-only'); END;
CREATE TRIGGER review_queue_proposals_audit_guard BEFORE UPDATE OF review_state ON review_queue_proposals WHEN old.review_state <> new.review_state BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM proposal_review_audit WHERE proposal_id=old.id AND from_state=old.review_state AND to_state=new.review_state) THEN RAISE(ABORT,'review transition requires audit') END;
END;
`},
] as const;

export interface SourceInput {
 id: string; provider: string; sourceId: string; stableUrl?: string; occurredAt?: string;
 observedAt: string; excerpt?: string; contentHash: string; classification: string; lastSeenAt: string; retentionUntil?: string;
}
export interface SyncBatch { connector: string; scope: string; cursor?: string; watermark?: string; observedAt: string; records: readonly SourceInput[]; }
export interface StorageExport { format: "em-os-storage"; version: 1; exportedAt: string; tables: Record<string, Record<string, unknown>[]>; }
const exportTables = ["people","source_records","sync_cursors","prs","initiatives","action_items","action_item_sources","evidence","evidence_sources","drafts","draft_sources","review_audit","review_queue_proposals","proposal_review_audit","deletion_tombstones"] as const;
const clearTables = [...exportTables, "cache_entries"] as const;

function utc(value: string): string {
 const date = new Date(value);
 if (!Number.isFinite(date.valueOf()) || !value.endsWith("Z")) throw new Error(`timestamp must be UTC ISO-8601: ${value}`);
 const iso = date.toISOString();
 if (value !== iso) throw new Error(`timestamp must be normalised UTC ISO-8601: ${value}`);
 return iso;
}

export class SqliteStorage implements Storage {
 readonly db: DatabaseSync;
 #reviewWrite: {mode:"transition"; actor:string; reason:string; changedAt:string}|{mode:"import"}|undefined;
 constructor(readonly path: string) {
  this.db = new DatabaseSync(path);
  this.db.function("em_review_write_mode",()=>this.#reviewWrite?.mode??"none");
  this.db.function("em_review_actor",()=>this.#reviewWrite?.mode==="transition"?this.#reviewWrite.actor:"");
  this.db.function("em_review_reason",()=>this.#reviewWrite?.mode==="transition"?this.#reviewWrite.reason:"");
  this.db.function("em_review_changed_at",()=>this.#reviewWrite?.mode==="transition"?this.#reviewWrite.changedAt:"");
  this.db.function("em_normalize_review_title",(value)=>normalizeReviewTitle(String(value)));
  this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
 }
 async initialize(): Promise<void> {
  this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const currentVersion = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
  const maxRow = this.db.prepare("SELECT COALESCE(MAX(version),0) version FROM schema_migrations").get() as {version:number};
  if (maxRow.version > currentVersion) throw new Error(`database schema version ${maxRow.version} is newer than supported version ${currentVersion}; open with a newer release first`);
  const applied = new Set((this.db.prepare("SELECT version FROM schema_migrations").all() as {version:number}[]).map(x=>x.version));
  for (const migration of migrations) if (!applied.has(migration.version)) this.transaction(() => {
   this.db.exec(migration.sql);
   this.db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(migration.version,new Date().toISOString());
  });
  this.db.exec(`PRAGMA user_version=${currentVersion}`);
 }
 close(): void { this.db.close(); }
 private transaction<T>(fn:()=>T): T {
  this.db.exec("BEGIN IMMEDIATE");
  try { const result=fn(); this.db.exec("COMMIT"); return result; } catch(error) { this.db.exec("ROLLBACK"); throw error; }
 }
 persistSync(batch: SyncBatch, beforeCursor?: ()=>void): void {
  const sql=`INSERT INTO source_records(id,provider,source_id,stable_url,occurred_at,observed_at,excerpt,content_hash,classification,last_seen_at,retention_until)
 SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM deletion_tombstones WHERE provider=? AND source_id=?)
 ON CONFLICT(provider,source_id) DO UPDATE SET stable_url=excluded.stable_url,occurred_at=excluded.occurred_at,observed_at=excluded.observed_at,excerpt=excluded.excerpt,content_hash=excluded.content_hash,classification=excluded.classification,last_seen_at=excluded.last_seen_at,retention_until=excluded.retention_until,updated_at=${ISO_UTC} WHERE source_records.deleted_at IS NULL`;
  this.transaction(()=>{
   const statement=this.db.prepare(sql);
   for(const r of batch.records) statement.run(r.id,r.provider,r.sourceId,r.stableUrl??null,r.occurredAt?utc(r.occurredAt):null,utc(r.observedAt),r.excerpt??null,r.contentHash,r.classification,utc(r.lastSeenAt),r.retentionUntil?utc(r.retentionUntil):null,r.provider,r.sourceId);
   beforeCursor?.();
   this.db.prepare(`INSERT INTO sync_cursors(connector,scope,cursor,watermark,last_success_at,fetched_count) VALUES(?,?,?,?,?,?)
    ON CONFLICT(connector,scope) DO UPDATE SET cursor=excluded.cursor,watermark=excluded.watermark,last_success_at=excluded.last_success_at,last_error=NULL,fetched_count=excluded.fetched_count,updated_at=${ISO_UTC}`)
    .run(batch.connector,batch.scope,batch.cursor??null,batch.watermark??null,utc(batch.observedAt),batch.records.length);
  });
 }
 getCursor(connector:string, scope:string):string|undefined {
  const row=this.db.prepare("SELECT cursor FROM sync_cursors WHERE connector=? AND scope=?").get(connector,scope) as {cursor:string|null}|undefined;
  return row?.cursor??undefined;
 }
 recordSlackError(connector:string, scope:string, message:string):void {
  this.db.prepare(`INSERT INTO sync_cursors(connector,scope,last_error) VALUES(?,?,?) ON CONFLICT(connector,scope) DO UPDATE SET last_error=excluded.last_error,updated_at=${ISO_UTC}`).run(connector,scope,message.slice(0,300));
 }
 persistSlackPage(page:SlackPersistencePage):void {
   const isTombstoned = this.db.prepare("SELECT 1 tombstoned FROM deletion_tombstones WHERE provider='slack' AND source_id=?");
   const isDeleted = this.db.prepare("SELECT deleted_at FROM source_records WHERE provider='slack' AND source_id=?");
   const sourceSql=`INSERT INTO source_records(id,provider,source_id,stable_url,occurred_at,observed_at,excerpt,content_hash,classification,last_seen_at,retention_until)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET stable_url=excluded.stable_url,occurred_at=excluded.occurred_at,observed_at=excluded.observed_at,excerpt=excluded.excerpt,content_hash=excluded.content_hash,classification=excluded.classification,last_seen_at=excluded.last_seen_at,retention_until=excluded.retention_until,updated_at=${ISO_UTC} WHERE source_records.deleted_at IS NULL`;
   this.transaction(()=>{
    const sourceStatement=this.db.prepare(sourceSql);
    const tombstoneStatement=this.db.prepare("INSERT INTO deletion_tombstones(provider,source_id,deleted_at,reason,content_hash) VALUES('slack',?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET deleted_at=excluded.deleted_at,reason=excluded.reason,content_hash=excluded.content_hash");
    const deletedSourceIds = new Set(page.deletedSourceIds);
    for(const r of page.records) {
     if ((isTombstoned.get(r.sourceId) as {tombstoned?:number}|undefined)?.tombstoned) continue;
     sourceStatement.run(r.id,r.provider,r.sourceId,r.stableUrl??null,utc(r.occurredAt),utc(r.observedAt),r.excerpt,r.contentHash,r.classification,utc(r.lastSeenAt),utc(r.retentionUntil));
    }
    for(const sourceId of page.deletedSourceIds){
     const row=this.db.prepare("SELECT id,content_hash FROM source_records WHERE provider='slack' AND source_id=?").get(sourceId) as {id:string;content_hash:string}|undefined;
     const at=utc(page.observedAt);
     if(!row){
      tombstoneStatement.run(sourceId,at,"source_deleted","");
      continue;
     }
     this.db.prepare("DELETE FROM review_queue_proposals WHERE source_record_id=? AND review_state='proposed'").run(row.id);
     this.db.prepare("DELETE FROM cache_entries WHERE source_record_id=?").run(row.id);
     this.db.prepare("UPDATE source_records SET excerpt=NULL,deleted_at=?,deletion_reason='source_deleted',updated_at=? WHERE id=?").run(at,at,row.id);
     tombstoneStatement.run(sourceId,at,"source_deleted",row.content_hash);
    }
    const proposalInsert = this.db.prepare(`INSERT INTO review_queue_proposals(id,kind,description,source_record_id) VALUES(?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,description=excluded.description,updated_at=${ISO_UTC} WHERE review_queue_proposals.review_state='proposed'`);
    for(const proposal of page.proposals) {
     const sourceId = proposal.sourceRecordId.slice("slack:message:".length);
     if (deletedSourceIds.has(sourceId)) continue;
     if ((isTombstoned.get(sourceId) as {tombstoned?:number}|undefined)?.tombstoned) continue;
     if ((isDeleted.get(sourceId) as {deleted_at:string|null}|undefined)?.deleted_at) continue;
     proposalInsert.run(proposal.id,proposal.kind,proposal.description,proposal.sourceRecordId);
    }
    this.db.prepare(`INSERT INTO sync_cursors(connector,scope,cursor,last_success_at,last_error,fetched_count) VALUES(?,?,?,?,NULL,?)
     ON CONFLICT(connector,scope) DO UPDATE SET cursor=excluded.cursor,last_success_at=excluded.last_success_at,last_error=NULL,fetched_count=excluded.fetched_count,updated_at=${ISO_UTC}`)
     .run(page.connector,page.scope,page.cursor??null,utc(page.observedAt),page.records.length+page.deletedSourceIds.length);
   });
 }
 transitionSlackProposal(proposalId:string,toState:"approved"|"rejected",actor:string,reason:string,changedAt:string):void {
  if(!actor.trim()||!reason.trim()) throw new Error("actor and reason are required");
  this.transaction(()=>{const row=this.db.prepare("SELECT review_state state FROM review_queue_proposals WHERE id=?").get(proposalId) as {state:string}|undefined;
   if(!row)throw new Error("proposal not found"); if(row.state!=="proposed")throw new Error(`terminal review state cannot transition: ${row.state}`);
   const at=utc(changedAt); this.db.prepare("INSERT INTO proposal_review_audit(proposal_id,from_state,to_state,actor,reason,changed_at) VALUES(?,?,?,?,?,?)").run(proposalId,row.state,toState,actor,reason,at);
   this.db.prepare("UPDATE review_queue_proposals SET review_state=?,updated_at=? WHERE id=?").run(toState,at,proposalId);
  });
 }
 async savePullRequests(records: readonly PullRequestRecord[], observedAt: string): Promise<void> {
  const when=utc(observedAt);
  this.transaction(()=>{ for(const record of records) {
   const sourceId=`${record.repository}:${record.id}`; const id=`${record.provider}:pr:${sourceId}`;
   this.db.prepare(`INSERT INTO source_records(id,provider,source_id,stable_url,observed_at,content_hash,classification,last_seen_at)
    SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM deletion_tombstones WHERE provider=? AND source_id=?)
    ON CONFLICT(provider,source_id) DO UPDATE SET stable_url=excluded.stable_url,observed_at=excluded.observed_at,last_seen_at=excluded.last_seen_at,updated_at=${ISO_UTC} WHERE source_records.deleted_at IS NULL`)
     .run(id,record.provider,sourceId,record.url,when,sourceId,"work",when,record.provider,sourceId);
   this.db.prepare(`INSERT INTO prs(id,source_record_id,provider,repository,source_id,author,title,url,updated_at,is_draft,ci_status,review_requested,last_relevant_activity_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM deletion_tombstones WHERE provider=? AND source_id=?)
      AND EXISTS(SELECT 1 FROM source_records WHERE id=? AND deleted_at IS NULL)
    ON CONFLICT(provider,repository,source_id) DO UPDATE SET author=excluded.author,title=excluded.title,url=excluded.url,updated_at=excluded.updated_at,is_draft=excluded.is_draft,ci_status=excluded.ci_status,review_requested=excluded.review_requested,last_relevant_activity_at=excluded.last_relevant_activity_at
      WHERE EXISTS(SELECT 1 FROM source_records WHERE id=excluded.source_record_id AND deleted_at IS NULL)`)
    .run(id,id,record.provider,record.repository,record.id,record.author,record.title,record.url,utc(record.updatedAt),Number(record.isDraft),record.ciStatus,Number(record.reviewRequestedOfViewer),utc(record.updatedAt),record.provider,sourceId,id);
  }});
 }
 async listPullRequests(): Promise<readonly PullRequestRecord[]> {
  return (this.db.prepare("SELECT p.provider,p.repository,p.source_id id,p.title,p.url,p.author,p.is_draft,p.review_requested,p.ci_status,p.updated_at FROM prs p INNER JOIN source_records s ON s.id=p.source_record_id WHERE s.deleted_at IS NULL ORDER BY p.provider,p.repository,p.source_id").all() as Record<string,unknown>[]).map(r=>({provider:String(r.provider),repository:String(r.repository),id:String(r.id),title:String(r.title),url:String(r.url),author:String(r.author),isDraft:Boolean(r.is_draft),reviewRequestedOfViewer:Boolean(r.review_requested),ciStatus:r.ci_status as PullRequestRecord["ciStatus"],updatedAt:String(r.updated_at)}));
 }
 transition(entityType:"action_item"|"evidence"|"draft", entityId:string, toState:"proposed"|"approved"|"rejected"|"superseded", actor:string, reason:string, changedAt:string): void {
  if(!actor.trim()||!reason.trim()) throw new Error("actor and reason are required");
  if(toState==="proposed") throw new Error("review transition must move away from proposed");
  const config={action_item:["action_items","review_state"],evidence:["evidence","status"],draft:["drafts","reviewer_state"]} as const;
  const [table,column]=config[entityType];
  const at=utc(changedAt);
  this.transaction(()=>{ const row=this.db.prepare(`SELECT ${column} state FROM ${table} WHERE id=?`).get(entityId) as {state:string}|undefined; if(!row) throw new Error("entity not found");
   if(row.state===toState) return;
   if(row.state!=="proposed") throw new Error(`terminal review state cannot transition: ${row.state}`);
   this.#reviewWrite={mode:"transition",actor,reason,changedAt:at};
   try { this.db.prepare(`UPDATE ${table} SET ${column}=?,updated_at=? WHERE id=?`).run(toState,at,entityId); }
   finally { this.#reviewWrite=undefined; }
  });
 }
 deleteSource(provider:string, sourceId:string, reason:string, deletedAt:string): void {
  this.transaction(()=>{ const row=this.db.prepare("SELECT id,content_hash FROM source_records WHERE provider=? AND source_id=?").get(provider,sourceId) as {id:string;content_hash:string}|undefined;
   const at=utc(deletedAt);
   if(row){this.db.prepare("DELETE FROM cache_entries WHERE source_record_id=?").run(row.id); this.db.prepare("UPDATE source_records SET excerpt=NULL,deleted_at=?,deletion_reason=?,updated_at=? WHERE id=?").run(at,reason,at,row.id);}
   this.db.prepare("INSERT INTO deletion_tombstones(provider,source_id,deleted_at,reason,content_hash) VALUES(?,?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET deleted_at=excluded.deleted_at,reason=excluded.reason,content_hash=COALESCE(deletion_tombstones.content_hash,excluded.content_hash)").run(provider,sourceId,at,reason,row?.content_hash??null);
  });
 }
 applyRetention(now:string): number {
  const rows=this.db.prepare("SELECT provider,source_id FROM source_records WHERE deleted_at IS NULL AND retention_until IS NOT NULL AND retention_until <= ?").all(utc(now)) as {provider:string;source_id:string}[];
  for(const row of rows)this.deleteSource(row.provider,row.source_id,"retention_expired",now);
  return rows.length;
 }
 adapterStore(): {
  getCursor(connector:string, scope:string): string|undefined;
  findSimilarProposals(provider:string, normalizedTitle:string, occurredAt:string): readonly string[];
  commitAdapterBatch(batch:unknown): void;
 } {
  type AdapterCommitLike = {
   connector: string; scope: string; previousCursor?: string; nextCursor?: string; observedAt: string; fetched: number;
   proposals: readonly { id:string; provider:string; sourceId:string; scope:string; kind:string; title:string; occurredAt:string; observedAt:string; sourceUrl:string; sourceLinks:readonly string[]; reviewState:string; retentionUntil:string; dedupSuggestions:readonly string[]; owner?:{ sourceIdentity:string; resolvedPersonId?:string; candidates:readonly {personId:string;label:string;confidence:number}[]; prompt?:string } }[];
   deletions: readonly { provider:string; sourceId:string; contentHash:string; deletedAt:string; reason:string }[];
  };
  const db=this.db; const ISO="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  return {
   getCursor(connector:string, scope:string):string|undefined {
    const row=db.prepare("SELECT cursor FROM sync_cursors WHERE connector=? AND scope=?").get(connector,scope) as {cursor:string|null}|undefined;
    return row?.cursor??undefined;
   },
   findSimilarProposals(_provider:string, normalizedTitle:string, occurredAt:string):readonly string[] {
    const rows=db.prepare(`SELECT p.id FROM review_queue_proposals p INNER JOIN source_records s ON s.id=p.source_record_id WHERE p.review_state='proposed' AND em_normalize_review_title(p.description)=? AND abs(strftime('%s',p.occurred_at)-strftime('%s',?)) <= 7*24*60*60`).all(normalizedTitle,occurredAt) as {id:string}[];
    return rows.map(r=>r.id);
   },
   commitAdapterBatch(batch:unknown):void {
    const b=batch as AdapterCommitLike;
    db.exec("BEGIN IMMEDIATE");
    try {
     const sourceSql=`INSERT INTO source_records(id,provider,source_id,stable_url,occurred_at,observed_at,excerpt,content_hash,classification,last_seen_at,retention_until)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET stable_url=excluded.stable_url,occurred_at=excluded.occurred_at,observed_at=excluded.observed_at,excerpt=excluded.excerpt,content_hash=excluded.content_hash,classification=excluded.classification,last_seen_at=excluded.last_seen_at,retention_until=excluded.retention_until,updated_at=${ISO} WHERE source_records.deleted_at IS NULL`;
     const sourceStmt=db.prepare(sourceSql);
     const proposalSql=`INSERT INTO review_queue_proposals(id,kind,description,source_record_id,source_context_json,source_links_json,occurred_at,retention_until)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,description=excluded.description,source_context_json=excluded.source_context_json,source_links_json=excluded.source_links_json,occurred_at=excluded.occurred_at,retention_until=excluded.retention_until,updated_at=${ISO} WHERE review_queue_proposals.review_state='proposed'`;
     const proposalStmt=db.prepare(proposalSql);

     const isTombstoned=db.prepare("SELECT 1 tombstoned FROM deletion_tombstones WHERE provider=? AND source_id=?");
     const isDeleted=db.prepare("SELECT deleted_at FROM source_records WHERE provider=? AND source_id=?");
     for(const proposal of b.proposals) {
      const recordId=`${proposal.provider}:source:${proposal.sourceId}`;
      const existingTombstone=(isTombstoned.get(proposal.provider,proposal.sourceId) as {tombstoned?:number}|undefined)?.tombstoned;
      const existingDeleted=(isDeleted.get(proposal.provider,proposal.sourceId) as {deleted_at?:string|null}|undefined)?.deleted_at;
      if(existingTombstone || existingDeleted) continue;
      sourceStmt.run(recordId,proposal.provider,proposal.sourceId,proposal.sourceUrl,proposal.occurredAt,proposal.observedAt,proposal.title,`sha256:${proposal.id}`,proposal.provider,proposal.observedAt,proposal.retentionUntil);
      proposalStmt.run(proposal.id,proposal.kind,proposal.title,recordId,JSON.stringify({owner:proposal.owner,dedupSuggestions:proposal.dedupSuggestions}),JSON.stringify(proposal.sourceLinks),proposal.occurredAt,proposal.retentionUntil);
     }
     for(const deletion of b.deletions) {
      const row=db.prepare("SELECT id,content_hash FROM source_records WHERE provider=? AND source_id=?").get(deletion.provider,deletion.sourceId) as {id:string;content_hash:string}|undefined;
      const at=utc(deletion.deletedAt);
      if(row) {
       db.prepare("DELETE FROM review_queue_proposals WHERE source_record_id=? AND review_state='proposed'").run(row.id);
       db.prepare("DELETE FROM cache_entries WHERE source_record_id=?").run(row.id);
       db.prepare("UPDATE source_records SET excerpt=NULL,deleted_at=?,deletion_reason=?,updated_at=? WHERE id=?").run(at,deletion.reason,at,row.id);
      }
      db.prepare("INSERT INTO deletion_tombstones(provider,source_id,deleted_at,reason,content_hash) VALUES(?,?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET deleted_at=excluded.deleted_at,reason=excluded.reason,content_hash=excluded.content_hash").run(deletion.provider,deletion.sourceId,at,deletion.reason,deletion.contentHash);
     }
     db.prepare(`INSERT INTO sync_cursors(connector,scope,cursor,watermark,last_success_at,last_error,fetched_count) VALUES(?,?,?,?,?,NULL,?)
      ON CONFLICT(connector,scope) DO UPDATE SET cursor=excluded.cursor,watermark=excluded.watermark,last_success_at=excluded.last_success_at,last_error=NULL,fetched_count=excluded.fetched_count,updated_at=${ISO}`)
      .run(b.connector,b.scope,b.nextCursor??b.previousCursor??null,b.nextCursor??b.previousCursor??null,utc(b.observedAt),b.fetched);
     db.exec("COMMIT");
    } catch(error) { db.exec("ROLLBACK"); throw error; }
   },
  };
 }
 exportData(exportedAt=new Date().toISOString()): StorageExport {
  const tables:StorageExport["tables"]={};
  for(const table of exportTables) {
   // PR metadata is derived from its source. Retain the local row to enforce
   // tombstones, but never make deleted content portable or restorable.
   const query=table==="prs"
    ? "SELECT p.* FROM prs p INNER JOIN source_records s ON s.id=p.source_record_id WHERE s.deleted_at IS NULL"
    : `SELECT * FROM ${table}`;
   tables[table]=this.db.prepare(query).all() as Record<string,unknown>[];
  }
  return {format:"em-os-storage",version:STORAGE_EXPORT_VERSION,exportedAt:utc(exportedAt),tables};
 }
 importData(data:StorageExport): void {
  if(data.format!=="em-os-storage"||data.version!==STORAGE_EXPORT_VERSION) throw new Error("unsupported storage export");
  // review transition and append-only guards are bypassed via em_review_write_mode()='import'.
  // Invariant validation before commit is performed by #assertReviewInvariants().
  this.transaction(()=>{
   this.db.exec("PRAGMA defer_foreign_keys=ON"); this.#reviewWrite={mode:"import"};
   try {
    for(const table of [...clearTables].reverse()) this.db.exec(`DELETE FROM ${table}`);
    for(const table of exportTables) for(const row of data.tables[table]??[]) {
     const keys=Object.keys(row); if(!keys.length)continue;
     this.db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(()=>"?").join(",")})`).run(...keys.map(k=>this.#normalizeImportValue(table,k,row[k]) as never));
    }
    this.#assertReviewInvariants();
    this.db.exec("INSERT INTO source_records_fts(source_records_fts) VALUES('rebuild')");
   } finally { this.#reviewWrite=undefined; }
  });
 }
 #normalizeImportValue(table:string, column:string, value:unknown): unknown {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return value;
  if (this.#isTimestampColumn(table,column)) return utc(value);
  return value;
 }
 #isTimestampColumn(table:string, column:string): boolean {
  const timestampColumns:Record<string,Set<string>>={
   people:new Set(["created_at","updated_at"]),
   source_records:new Set(["occurred_at","observed_at","last_seen_at","retention_until","deleted_at","created_at","updated_at"]),
   sync_cursors:new Set(["last_success_at","updated_at"]),
   prs:new Set(["created_at","updated_at","merged_at","last_relevant_activity_at"]),
   initiatives:new Set(["deadline","created_at","updated_at"]),
   action_items:new Set(["due_at","snoozed_until","created_at","updated_at"]),
   evidence:new Set(["observed_at","created_at","updated_at"]),
   drafts:new Set(["generated_at","created_at","updated_at"]),
   review_audit:new Set(["changed_at"]),
   deletion_tombstones:new Set(["deleted_at"]),
   cache_entries:new Set(["expires_at"]),
  };
  return timestampColumns[table]?.has(column)??false;
 }
 #assertReviewInvariants(): void {
  const terminalStates = new Set(["approved","rejected","superseded"]);
  const entities = [
   ...this.db.prepare("SELECT id, 'action_item' entity_type, review_state state FROM action_items").all() as {id:string;entity_type:string;state:string}[],
   ...this.db.prepare("SELECT id, 'evidence' entity_type, status state FROM evidence").all() as {id:string;entity_type:string;state:string}[],
   ...this.db.prepare("SELECT id, 'draft' entity_type, reviewer_state state FROM drafts").all() as {id:string;entity_type:string;state:string}[],
  ];
  for (const row of entities) {
   const audits=this.db.prepare("SELECT from_state,to_state FROM review_audit WHERE entity_type=? AND entity_id=? ORDER BY id").all(row.entity_type,row.id) as {from_state:string;to_state:string}[];
   if (row.state==="proposed") {
    if (audits.length) throw new Error(`import violates review invariant: ${row.entity_type} ${row.id} proposed state has audit history`);
    continue;
   }
   if (!terminalStates.has(row.state)) throw new Error(`import violates review invariant: ${row.entity_type} ${row.id} has invalid state ${row.state}`);
   if (audits.length!==1 || audits[0].from_state!=="proposed" || audits[0].to_state!==row.state)
    throw new Error(`import violates review invariant: ${row.entity_type} ${row.id} terminal state ${row.state} requires exactly one proposed-to-${row.state} audit row`);
  }
  const dangling = this.db.prepare(`SELECT a.entity_type, a.entity_id FROM review_audit a
   WHERE (a.entity_type='action_item' AND NOT EXISTS (SELECT 1 FROM action_items i WHERE i.id=a.entity_id))
      OR (a.entity_type='evidence' AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.id=a.entity_id))
      OR (a.entity_type='draft' AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.id=a.entity_id))`).get() as {entity_type:string;entity_id:string}|undefined;
  if (dangling) throw new Error(`import violates review invariant: audit references missing ${dangling.entity_type} ${dangling.entity_id}`);
 }
 async backupToRawSQLite(destination:string):Promise<void>{await mkdir(dirname(destination),{recursive:true}); await backup(this.db,destination);}
 static async restoreFromRawSQLite(path:string):Promise<SqliteStorage>{const storage=new SqliteStorage(path);await storage.initialize();return storage;}

 // Plaintext paths are dev-only and explicitly named insecure.
 async backupToDevInsecure(destination:string):Promise<void>{await mkdir(dirname(destination),{recursive:true}); await backup(this.db,destination);}
 async writeExportDevInsecure(path:string):Promise<void>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(this.exportData(),null,2),{encoding:"utf8",mode:0o600});}

 async backupToEncrypted(destination:string, kekSource:BackupKeySource):Promise<void>{
  await mkdir(dirname(destination),{recursive:true});
  const tmp=await mkdtemp(join(tmpdir(),"em-os-backup-"));
  try {
   const plain=join(tmp,"plain.sqlite");
   await backup(this.db,plain);
   const bytes=await readFile(plain);
   const envelope=encryptBackupArtifact(bytes,"sqlite-backup",kekSource);
   await writeFile(destination,JSON.stringify(envelope,null,2),{encoding:"utf8",mode:0o600});
  } finally { await rm(tmp,{recursive:true,force:true}); }
 }

 async writeExport(path:string, kekSource:BackupKeySource):Promise<void>{
  await mkdir(dirname(path),{recursive:true});
  const bytes=Buffer.from(JSON.stringify(this.exportData(),null,2),"utf8");
  const envelope=encryptBackupArtifact(bytes,"em-os-storage",kekSource);
  await writeFile(path,JSON.stringify(envelope,null,2),{encoding:"utf8",mode:0o600});
 }

 static async restoreFromEncryptedBackup(path:string, destinationDb:string, kekSource:BackupKeySource):Promise<SqliteStorage>{
  const envelope=parseEncryptedBackupEnvelope(await readFile(path,"utf8"));
  const decrypted=decryptBackupArtifact(envelope,kekSource,"sqlite-backup");
  const tmp=await mkdtemp(join(tmpdir(),"em-os-restore-"));
  try {
   const plain=join(tmp,"restored.sqlite");
   await writeFile(plain,decrypted);
   await mkdir(dirname(destinationDb),{recursive:true});
   // Ensure destinationDb file exists as an empty SQLite database so backup() accepts it, with 0o600 per ADR 0008 restored-material handling.
   await writeFile(destinationDb, Buffer.alloc(0), { mode: 0o600 });
   const destDb=new DatabaseSync(destinationDb);
   try { destDb.close(); } catch { destDb.close(); }
   const plainDb=new DatabaseSync(plain);
   try { await backup(plainDb,destinationDb); } finally { plainDb.close(); }
   await chmod(destinationDb,0o600);
   const storage=new SqliteStorage(destinationDb); await storage.initialize(); return storage;
  } finally { await rm(tmp,{recursive:true,force:true}); }
 }

 static async restoreFromExport(pathOrEnvelope:string|EncryptedBackupEnvelope, destinationDb:string, kekSource:BackupKeySource):Promise<SqliteStorage>{
   const envelope = typeof pathOrEnvelope === "string" ? parseEncryptedBackupEnvelope(await readFile(pathOrEnvelope,"utf8")) : pathOrEnvelope;
   const decrypted=decryptBackupArtifact(envelope,kekSource,"em-os-storage");
   const data=JSON.parse(decrypted.toString("utf8")) as StorageExport;
   // Pre-create the restored DB file with 0o600 before SqliteStorage opens it.
   await mkdir(dirname(destinationDb),{recursive:true});
   await writeFile(destinationDb, Buffer.alloc(0), { mode: 0o600 });
   const storage=new SqliteStorage(destinationDb); await storage.initialize(); storage.importData(data); await chmod(destinationDb,0o600); return storage;
 }

 static async restoreFromExportDevInsecure(path:string, destinationDb:string):Promise<SqliteStorage>{
  const storage=new SqliteStorage(destinationDb);await storage.initialize();storage.importData(JSON.parse(await readFile(path,"utf8")) as StorageExport);return storage;
 }
}

export type { BackupArtifact, EncryptedBackupEnvelope };
export { BackupEnvelopeError, BackupKeyUnavailableError, recomputeHeaderAAD };
export type { BackupKeySource } from "./backup-envelope.js";
