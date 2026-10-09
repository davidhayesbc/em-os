import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PullRequestRecord, Storage } from "./contracts.js";

export const STORAGE_EXPORT_VERSION = 1 as const;
const ISO_UTC = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const migrations = [
  {
    version: 1,
    sql: `
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
`},
] as const;

export interface SourceInput {
 id: string; provider: string; sourceId: string; stableUrl?: string; occurredAt?: string;
 observedAt: string; excerpt?: string; contentHash: string; classification: string; lastSeenAt: string; retentionUntil?: string;
}
export interface SyncBatch { connector: string; scope: string; cursor?: string; watermark?: string; observedAt: string; records: readonly SourceInput[]; }
export interface StorageExport { format: "em-os-storage"; version: 1; exportedAt: string; tables: Record<string, Record<string, unknown>[]>; }
const exportTables = ["people","source_records","sync_cursors","prs","initiatives","action_items","action_item_sources","evidence","evidence_sources","drafts","draft_sources","review_audit","deletion_tombstones"] as const;
const clearTables = [...exportTables, "cache_entries"] as const;

function utc(value: string): string {
 const date = new Date(value);
 if (!Number.isFinite(date.valueOf()) || !value.endsWith("Z")) throw new Error(`timestamp must be UTC ISO-8601: ${value}`);
 return date.toISOString();
}

export class SqliteStorage implements Storage {
 readonly db: DatabaseSync;
 constructor(readonly path: string) {
  this.db = new DatabaseSync(path);
  this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
 }
 async initialize(): Promise<void> {
  this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set((this.db.prepare("SELECT version FROM schema_migrations").all() as {version:number}[]).map(x=>x.version));
  for (const migration of migrations) if (!applied.has(migration.version)) this.transaction(() => {
   this.db.exec(migration.sql);
   this.db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)").run(migration.version,new Date().toISOString());
  });
 }
 close(): void { this.db.close(); }
 private transaction<T>(fn:()=>T): T {
  this.db.exec("BEGIN IMMEDIATE");
  try { const result=fn(); this.db.exec("COMMIT"); return result; } catch(error) { this.db.exec("ROLLBACK"); throw error; }
 }
 persistSync(batch: SyncBatch, beforeCursor?: ()=>void): void {
  const sql=`INSERT INTO source_records(id,provider,source_id,stable_url,occurred_at,observed_at,excerpt,content_hash,classification,last_seen_at,retention_until)
 VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET stable_url=excluded.stable_url,occurred_at=excluded.occurred_at,observed_at=excluded.observed_at,excerpt=excluded.excerpt,content_hash=excluded.content_hash,classification=excluded.classification,last_seen_at=excluded.last_seen_at,retention_until=excluded.retention_until,updated_at=${ISO_UTC} WHERE source_records.deleted_at IS NULL`;
  this.transaction(()=>{
   const statement=this.db.prepare(sql);
   for(const r of batch.records) statement.run(r.id,r.provider,r.sourceId,r.stableUrl??null,r.occurredAt?utc(r.occurredAt):null,utc(r.observedAt),r.excerpt??null,r.contentHash,r.classification,utc(r.lastSeenAt),r.retentionUntil?utc(r.retentionUntil):null);
   beforeCursor?.();
   this.db.prepare(`INSERT INTO sync_cursors(connector,scope,cursor,watermark,last_success_at,fetched_count) VALUES(?,?,?,?,?,?)
    ON CONFLICT(connector,scope) DO UPDATE SET cursor=excluded.cursor,watermark=excluded.watermark,last_success_at=excluded.last_success_at,last_error=NULL,fetched_count=excluded.fetched_count,updated_at=${ISO_UTC}`)
    .run(batch.connector,batch.scope,batch.cursor??null,batch.watermark??null,utc(batch.observedAt),batch.records.length);
  });
 }
 async savePullRequests(records: readonly PullRequestRecord[], observedAt: string): Promise<void> {
  const when=utc(observedAt);
  this.transaction(()=>{ for(const record of records) {
   const sourceId=`${record.repository}:${record.id}`; const id=`${record.provider}:pr:${sourceId}`;
   this.db.prepare(`INSERT INTO source_records(id,provider,source_id,stable_url,observed_at,content_hash,classification,last_seen_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(provider,source_id) DO UPDATE SET stable_url=excluded.stable_url,observed_at=excluded.observed_at,last_seen_at=excluded.last_seen_at,updated_at=${ISO_UTC}`)
    .run(id,record.provider,sourceId,record.url,when,sourceId,"work",when);
   this.db.prepare(`INSERT INTO prs(id,source_record_id,provider,repository,source_id,author,title,url,updated_at,is_draft,ci_status,review_requested,last_relevant_activity_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,repository,source_id) DO UPDATE SET author=excluded.author,title=excluded.title,url=excluded.url,updated_at=excluded.updated_at,is_draft=excluded.is_draft,ci_status=excluded.ci_status,review_requested=excluded.review_requested,last_relevant_activity_at=excluded.last_relevant_activity_at`)
    .run(id,id,record.provider,record.repository,record.id,record.author,record.title,record.url,utc(record.updatedAt),Number(record.isDraft),record.ciStatus,Number(record.reviewRequestedOfViewer),utc(record.updatedAt));
  }});
 }
 async listPullRequests(): Promise<readonly PullRequestRecord[]> {
  return (this.db.prepare("SELECT provider,repository,source_id id,title,url,author,is_draft,review_requested,ci_status,updated_at FROM prs ORDER BY provider,repository,source_id").all() as Record<string,unknown>[]).map(r=>({provider:String(r.provider),repository:String(r.repository),id:String(r.id),title:String(r.title),url:String(r.url),author:String(r.author),isDraft:Boolean(r.is_draft),reviewRequestedOfViewer:Boolean(r.review_requested),ciStatus:r.ci_status as PullRequestRecord["ciStatus"],updatedAt:String(r.updated_at)}));
 }
 transition(entityType:"action_item"|"evidence"|"draft", entityId:string, toState:"proposed"|"approved"|"rejected"|"superseded", actor:string, reason:string, changedAt:string): void {
  if(!actor.trim()||!reason.trim()) throw new Error("actor and reason are required");
  const config={action_item:["action_items","review_state"],evidence:["evidence","status"],draft:["drafts","reviewer_state"]} as const;
  const [table,column]=config[entityType];
  this.transaction(()=>{ const row=this.db.prepare(`SELECT ${column} state FROM ${table} WHERE id=?`).get(entityId) as {state:string}|undefined; if(!row) throw new Error("entity not found");
   if(row.state===toState) return;
   if(row.state!=="proposed") throw new Error(`terminal review state cannot transition: ${row.state}`);
   this.db.prepare("INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES(?,?,?,?,?,?,?)").run(entityType,entityId,row.state,toState,actor,reason,utc(changedAt));
   this.db.prepare(`UPDATE ${table} SET ${column}=?,updated_at=? WHERE id=?`).run(toState,utc(changedAt),entityId);
  });
 }
 deleteSource(provider:string, sourceId:string, reason:string, deletedAt:string): void {
  this.transaction(()=>{ const row=this.db.prepare("SELECT id,content_hash FROM source_records WHERE provider=? AND source_id=?").get(provider,sourceId) as {id:string;content_hash:string}|undefined; if(!row)return;
   const at=utc(deletedAt);
   this.db.prepare("DELETE FROM cache_entries WHERE source_record_id=?").run(row.id);
   this.db.prepare("UPDATE source_records SET excerpt=NULL,deleted_at=?,deletion_reason=?,updated_at=? WHERE id=?").run(at,reason,at,row.id);
   this.db.prepare("INSERT INTO deletion_tombstones(provider,source_id,deleted_at,reason,content_hash) VALUES(?,?,?,?,?) ON CONFLICT(provider,source_id) DO UPDATE SET deleted_at=excluded.deleted_at,reason=excluded.reason,content_hash=excluded.content_hash").run(provider,sourceId,at,reason,row.content_hash);
  });
 }
 applyRetention(now:string): number {
  const rows=this.db.prepare("SELECT provider,source_id FROM source_records WHERE deleted_at IS NULL AND retention_until IS NOT NULL AND retention_until <= ?").all(utc(now)) as {provider:string;source_id:string}[];
  for(const row of rows)this.deleteSource(row.provider,row.source_id,"retention_expired",now);
  return rows.length;
 }
 exportData(exportedAt=new Date().toISOString()): StorageExport {
  const tables:StorageExport["tables"]={}; for(const table of exportTables) tables[table]=this.db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[];
  return {format:"em-os-storage",version:STORAGE_EXPORT_VERSION,exportedAt:utc(exportedAt),tables};
 }
 importData(data:StorageExport): void {
  if(data.format!=="em-os-storage"||data.version!==STORAGE_EXPORT_VERSION) throw new Error("unsupported storage export");
  this.transaction(()=>{ this.db.exec("PRAGMA defer_foreign_keys=ON");
   for(const table of [...clearTables].reverse()) this.db.exec(`DELETE FROM ${table}`);
   for(const table of exportTables) for(const row of data.tables[table]??[]) { const keys=Object.keys(row); if(!keys.length)continue; this.db.prepare(`INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(()=>"?").join(",")})`).run(...keys.map(k=>row[k] as never)); }
  });
 }
 async backupTo(destination:string):Promise<void>{await mkdir(dirname(destination),{recursive:true}); await backup(this.db,destination);}
 static async restoreFromExport(path:string, exportPath:string):Promise<SqliteStorage>{const storage=new SqliteStorage(path);await storage.initialize();storage.importData(JSON.parse(await readFile(exportPath,"utf8")) as StorageExport);return storage;}
 async writeExport(path:string):Promise<void>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(this.exportData(),null,2),{encoding:"utf8",mode:0o600});}
}
