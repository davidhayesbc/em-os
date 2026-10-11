import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SqliteStorage } from "./storage.js";

async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),"em-os-storage-"));
 const store=new SqliteStorage(join(dir,"store.sqlite")); await store.initialize();
 return {dir,store,cleanup:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}
const record={id:"github:pr:acme/api:42",provider:"github",sourceId:"acme/api:42",stableUrl:"https://example.invalid/acme/api/pull/42",observedAt:"2026-10-09T09:00:00.000Z",excerpt:"Synthetic review requested",contentHash:"sha256:synthetic",classification:"internal",lastSeenAt:"2026-10-09T09:00:00.000Z"};

test("empty database migrates with foreign keys and FTS5",async()=>{const x=await fixture();try{
 assert.deepEqual(Array.from(x.store.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(), row=>({...row})),[{version:1},{version:2},{version:3}]);
 const schemaRows=x.store.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name IN ('action_review_guard','review_audit_no_insert','review_queue_proposals','proposal_review_audit') ORDER BY name").all() as {type:string;name:string;sql:string}[];
 assert.deepEqual(schemaRows.map(({type,name})=>({type,name})),[
  {type:"trigger",name:"action_review_guard"},
  {type:"table",name:"proposal_review_audit"},
  {type:"trigger",name:"review_audit_no_insert"},
  {type:"table",name:"review_queue_proposals"},
 ]);
 assert.match(schemaRows.find(row=>row.name==="action_review_guard")!.sql,/em_review_write_mode\(\)/);
 assert.match(schemaRows.find(row=>row.name==="review_audit_no_insert")!.sql,/em_review_write_mode\(\)/);
 assert.equal((x.store.db.prepare("PRAGMA foreign_keys").get() as {foreign_keys:number}).foreign_keys,1);
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"c1",observedAt:record.observedAt,records:[record]});
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records_fts WHERE source_records_fts MATCH 'review'").get() as {n:number}).n,1);
}finally{await x.cleanup();}});

test("repeated sync is idempotent and cursor follows durable persistence",async()=>{const x=await fixture();try{
 const batch={connector:"github",scope:"acme/api",cursor:"c1",observedAt:record.observedAt,records:[record]}; x.store.persistSync(batch); x.store.persistSync({...batch,cursor:"c2"});
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n,1);
 assert.equal((x.store.db.prepare("SELECT cursor FROM sync_cursors").get() as {cursor:string}).cursor,"c2");
 assert.throws(()=>x.store.persistSync({...batch,cursor:"must-rollback"},()=>{throw new Error("synthetic persistence failure")}),/synthetic persistence failure/);
 assert.equal((x.store.db.prepare("SELECT cursor FROM sync_cursors").get() as {cursor:string}).cursor,"c2");
}finally{await x.cleanup();}});

test("retention removes excerpts, FTS rows and caches but keeps tombstone",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",observedAt:record.observedAt,records:[{...record,retentionUntil:"2026-10-10T00:00:00.000Z"}]});
 x.store.db.prepare("INSERT INTO cache_entries(cache_key,source_record_id,value) VALUES(?,?,?)").run("summary",record.id,"derived excerpt");
 assert.equal(x.store.applyRetention("2026-10-11T00:00:00.000Z"),1);
 assert.equal((x.store.db.prepare("SELECT excerpt FROM source_records").get() as {excerpt:null}).excerpt,null);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records_fts WHERE source_records_fts MATCH 'review'").get() as {n:number}).n,0);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM cache_entries").get() as {n:number}).n,0);
 assert.equal((x.store.db.prepare("SELECT reason FROM deletion_tombstones").get() as {reason:string}).reason,"retention_expired");
}finally{await x.cleanup();}});

test("direct audit pre-inserts cannot bypass API-only transitions for any review entity",async()=>{const x=await fixture();try{
 assert.throws(()=>x.store.db.prepare("INSERT INTO action_items(id,description,review_state) VALUES('bad','bad','approved')").run(),/start proposed/);
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES(?,?)").run("a1","Review synthetic PR");
 x.store.db.prepare("INSERT INTO people(id,display_name) VALUES('p1','Synthetic Person')").run();
 x.store.db.prepare("INSERT INTO evidence(id,subject_person_id,observation,author,observed_at,sensitivity) VALUES('e1','p1','Synthetic observation','manager','2026-10-09T09:00:00.000Z','private')").run();
 x.store.db.prepare("INSERT INTO drafts(id,type,period,audience,input_record_ids_json,generated_at) VALUES('d1','review','2026-Q4','manager','[]','2026-10-09T09:00:00.000Z')").run();
 for(const [type,id,table,column] of [["action_item","a1","action_items","review_state"],["evidence","e1","evidence","status"],["draft","d1","drafts","reviewer_state"]] as const){
  assert.throws(()=>x.store.db.prepare("INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES(?,?,'proposed','approved','intruder','bypass','2026-10-09T10:00:00.000Z')").run(type,id),/only be written by storage API/);
  assert.throws(()=>x.store.db.prepare(`UPDATE ${table} SET ${column}='approved' WHERE id=?`).run(id),/requires storage API/);
  x.store.transition(type,id,"approved","manager","verified source","2026-10-09T10:00:00.000Z");
  assert.equal((x.store.db.prepare(`SELECT ${column} state FROM ${table} WHERE id=?`).get(id) as {state:string}).state,"approved");
 }
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_audit").get() as {n:number}).n,3);
 x.store.transition("action_item","a1","approved","manager","verified source","2026-10-09T10:00:00.000Z");
 assert.throws(()=>x.store.transition("action_item","a1","rejected","manager","changed mind","2026-10-09T11:00:00.000Z"),/terminal review state/);
 assert.throws(()=>x.store.db.prepare("UPDATE action_items SET review_state='rejected' WHERE id='a1'").run(),/requires storage API/);
 assert.throws(()=>x.store.db.prepare("DELETE FROM review_audit WHERE entity_id='a1'").run(),/append-only/);
}finally{await x.cleanup();}});

test("a deletion tombstone prevents stale sync from restoring excerpts",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",observedAt:record.observedAt,records:[record]});
 x.store.deleteSource(record.provider,record.sourceId,"source_deleted","2026-10-10T00:00:00.000Z");
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"later",observedAt:"2026-10-11T00:00:00.000Z",records:[{...record,observedAt:"2026-10-11T00:00:00.000Z",lastSeenAt:"2026-10-11T00:00:00.000Z"}]});
 const row=x.store.db.prepare("SELECT excerpt,deleted_at FROM source_records").get() as {excerpt:null;deleted_at:string};
 assert.equal(row.excerpt,null); assert.equal(row.deleted_at,"2026-10-10T00:00:00.000Z");
}finally{await x.cleanup();}});
test("deletion before first live copy creates a tombstone that suppresses later live copy",async()=>{const x=await fixture();try{
 x.store.persistSlackPage({ connector:"slack-public-review-queue", scope:"CPUBLIC1", observedAt:"2026-10-09T09:00:00.000Z", records:[], deletedSourceIds:["CPUBLIC1:1700000000.003"], proposals:[] });
 x.store.persistSlackPage({ connector:"slack-public-review-queue", scope:"CPUBLIC1", observedAt:"2026-10-09T09:01:00.000Z", records:[{id:"slack:message:CPUBLIC1:1700000000.003",provider:"slack",sourceId:"CPUBLIC1:1700000000.003",stableUrl:"https://example.invalid/archives/CPUBLIC1/p1700000000003",occurredAt:"2026-10-08T12:00:00.000Z",observedAt:"2026-10-09T09:01:00.000Z",excerpt:"Late live copy",contentHash:"sha256:late",classification:"work",lastSeenAt:"2026-10-09T09:01:00.000Z",retentionUntil:"2026-11-08T09:01:00.000Z"}], deletedSourceIds:[], proposals:[] });
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n,0);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM deletion_tombstones WHERE source_id='CPUBLIC1:1700000000.003'").get() as {n:number}).n,1);
}finally{await x.cleanup();}});
test("slack deletion removes a proposal and later live replay cannot resurrect it",async()=>{const x=await fixture();try{
 const sourceRecordId="slack:message:CPUBLIC1:1700000000.004";
 const proposalId="slack:proposal:CPUBLIC1:1700000000.004";
 x.store.persistSlackPage({ connector:"slack-public-review-queue", scope:"CPUBLIC1", observedAt:"2026-10-09T09:00:00.000Z", records:[{id:sourceRecordId,provider:"slack",sourceId:"CPUBLIC1:1700000000.004",stableUrl:"https://example.invalid/archives/CPUBLIC1/p1700000000004",occurredAt:"2026-10-08T12:00:00.000Z",observedAt:"2026-10-09T09:00:00.000Z",excerpt:"Action needed",contentHash:"sha256:live",classification:"work",lastSeenAt:"2026-10-09T09:00:00.000Z",retentionUntil:"2026-11-08T09:00:00.000Z"}], deletedSourceIds:[], proposals:[{id:proposalId,kind:"action",description:"Action needed",sourceRecordId}]});
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_queue_proposals").get() as {n:number}).n,1);
 x.store.persistSlackPage({ connector:"slack-public-review-queue", scope:"CPUBLIC1", observedAt:"2026-10-09T09:02:00.000Z", records:[], deletedSourceIds:["CPUBLIC1:1700000000.004"], proposals:[] });
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_queue_proposals").get() as {n:number}).n,0);
 assert.equal((x.store.db.prepare("SELECT excerpt FROM source_records WHERE source_id='CPUBLIC1:1700000000.004'").get() as {excerpt:null}).excerpt,null);
 x.store.persistSlackPage({ connector:"slack-public-review-queue", scope:"CPUBLIC1", observedAt:"2026-10-09T09:03:00.000Z", records:[{id:sourceRecordId,provider:"slack",sourceId:"CPUBLIC1:1700000000.004",stableUrl:"https://example.invalid/archives/CPUBLIC1/p1700000000004",occurredAt:"2026-10-08T12:00:00.000Z",observedAt:"2026-10-09T09:03:00.000Z",excerpt:"Replay action needed",contentHash:"sha256:replay",classification:"work",lastSeenAt:"2026-10-09T09:03:00.000Z",retentionUntil:"2026-11-08T09:03:00.000Z"}], deletedSourceIds:[], proposals:[{id:proposalId,kind:"action",description:"Replay action needed",sourceRecordId}]});
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_queue_proposals").get() as {n:number}).n,0);
 const row=x.store.db.prepare("SELECT excerpt,deleted_at FROM source_records WHERE source_id='CPUBLIC1:1700000000.004'").get() as {excerpt:null;deleted_at:string};
 assert.equal(row.excerpt,null);
 assert.equal(row.deleted_at,"2026-10-09T09:02:00.000Z");
}finally{await x.cleanup();}});

test("delete-before-sync persists a durable tombstone and suppresses stale materialization",async()=>{const x=await fixture();try{
 x.store.deleteSource(record.provider,record.sourceId,"source_deleted","2026-10-10T00:00:00.000Z");
 assert.deepEqual({...x.store.db.prepare("SELECT provider,source_id,content_hash FROM deletion_tombstones").get()},{provider:record.provider,source_id:record.sourceId,content_hash:null});
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"stale",observedAt:record.observedAt,records:[record]});
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n,0);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM deletion_tombstones").get() as {n:number}).n,1);
}finally{await x.cleanup();}});

test("versioned export/import and SQLite backup restore data, including encrypted backup round-trip with wrong-key and tamper rejection",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"c1",observedAt:record.observedAt,records:[record]});
 const exportPath=join(x.dir,"backup","export.json"); await x.store.writeExport(exportPath);
 const parsed=JSON.parse(await readFile(exportPath,"utf8")); assert.equal(parsed.version,1);
 const restored=await SqliteStorage.restoreFromExport(join(x.dir,"restored.sqlite"),exportPath);
 assert.equal((restored.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n,1); restored.close();
 const backupPath=join(x.dir,"backup","store.sqlite"); await x.store.backupTo(backupPath);
 const backup=new SqliteStorage(backupPath); await backup.initialize(); assert.equal((backup.db.prepare("SELECT cursor FROM sync_cursors").get() as {cursor:string}).cursor,"c1"); backup.close();

 // Authenticated encrypted backup round-trip
 const key="synthetic-demo-key-32-chars-long";
 const encryptedPath=join(x.dir,"backup","encrypted.json");
 const envelope=await x.store.writeEncryptedBackup(encryptedPath,key);
 assert.equal(envelope.manifest.format,"em-os-encrypted-backup");
 assert.equal(envelope.manifest.version,1);
 assert.equal(envelope.manifest.schemaVersion,1);
 assert.equal(typeof envelope.manifest.integrity,"string");
 assert.equal(typeof envelope.iv,"string");
 assert.equal(typeof envelope.ciphertext,"string");
 assert.equal(typeof envelope.authTag,"string");
 const encryptedRestored=await SqliteStorage.restoreFromEncryptedBackup(encryptedPath,key,join(x.dir,"restored-enc.sqlite"));
 assert.equal((encryptedRestored.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n,1);
 assert.equal((encryptedRestored.db.prepare("SELECT cursor FROM sync_cursors").get() as {cursor:string}).cursor,"c1");
 encryptedRestored.close();

 // Wrong key fails closed without decrypting usable plaintext
 await assert.rejects(SqliteStorage.restoreFromEncryptedBackup(encryptedPath,"wrong-key-32-chars-long-zz",join(x.dir,"bad-key.sqlite")),/backup decryption failed/);

 // Tampered ciphertext fails integrity/auth
 const tampered=JSON.parse(await readFile(encryptedPath,"utf8")) as {ciphertext:string};
 const altered=Buffer.from(tampered.ciphertext,"base64url");
 altered[0]=altered[0]^0xff;
 await writeFile(encryptedPath,JSON.stringify({...tampered,ciphertext:altered.toString("base64url")},null,2));
 await assert.rejects(SqliteStorage.restoreFromEncryptedBackup(encryptedPath,key,join(x.dir,"bad-integrity.sqlite")),/backup decryption failed|tampered payload/);
}finally{await x.cleanup();}});

test("deleted PR is excluded from listPullRequests while tombstone remains",async()=>{const x=await fixture();try{
 const pr={provider:"github",repository:"acme/api",id:"42",title:"Synthetic PR",url:"https://example.invalid/acme/api/pull/42",author:"alice",isDraft:false,reviewRequestedOfViewer:true,ciStatus:"passing" as const,updatedAt:"2026-10-09T09:00:00.000Z"};
 await x.store.savePullRequests([pr],record.observedAt);
 assert.equal((await x.store.listPullRequests()).length,1);
 x.store.deleteSource("github","acme/api:42","source_deleted","2026-10-10T00:00:00.000Z");
 assert.equal((await x.store.listPullRequests()).length,0);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM deletion_tombstones").get() as {n:number}).n,1);
 assert.equal((x.store.db.prepare("SELECT title FROM prs").get() as {title:string}).title,"Synthetic PR");
}finally{await x.cleanup();}});

test("timestamps reject local offsets and normalize UTC fixtures",async()=>{const x=await fixture();try{
 assert.throws(()=>x.store.persistSync({connector:"calendar",scope:"synthetic",observedAt:"2026-11-01T01:30:00-04:00",records:[]}),/must be UTC/);
 x.store.persistSync({connector:"calendar",scope:"synthetic",observedAt:"2026-11-01T05:30:00.000Z",records:[]});
 assert.equal((x.store.db.prepare("SELECT last_success_at FROM sync_cursors").get() as {last_success_at:string}).last_success_at,"2026-11-01T05:30:00.000Z");
}finally{await x.cleanup();}});

test("pull request ingestion respects tombstones before and after materialization",async()=>{const x=await fixture();try{
 const pr={provider:"github",repository:"acme/api",id:"42",title:"Synthetic PR",url:record.stableUrl,author:"octocat",isDraft:false,reviewRequestedOfViewer:true,ciStatus:"passing" as const,updatedAt:record.observedAt};
 await x.store.savePullRequests([pr],record.observedAt);
 x.store.deleteSource(record.provider,record.sourceId,"source_deleted","2026-10-10T00:00:00.000Z");
 await x.store.savePullRequests([{...pr,title:"must not update",updatedAt:"2026-10-11T00:00:00.000Z"}],"2026-10-11T00:00:00.000Z");
 assert.deepEqual({...x.store.db.prepare("SELECT deleted_at,excerpt FROM source_records WHERE provider=? AND source_id=?").get(record.provider,record.sourceId)},{deleted_at:"2026-10-10T00:00:00.000Z",excerpt:null});
 assert.equal((x.store.db.prepare("SELECT title FROM prs WHERE provider=? AND repository=? AND source_id=?").get(pr.provider,pr.repository,pr.id) as {title:string}).title,"Synthetic PR");
 const before={...pr,id:"43",url:"https://example.invalid/acme/api/pull/43"};
 x.store.deleteSource(before.provider,`${before.repository}:${before.id}`,"source_deleted","2026-10-10T00:00:00.000Z");
 await x.store.savePullRequests([before],record.observedAt);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records WHERE provider=? AND source_id=?").get(before.provider,`${before.repository}:${before.id}`) as {n:number}).n,0);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM prs WHERE provider=? AND repository=? AND source_id=?").get(before.provider,before.repository,before.id) as {n:number}).n,0);
}finally{await x.cleanup();}});

test("import replaces existing audited data and can be repeated",async()=>{const x=await fixture();try{
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES('source','Source action')").run();
 x.store.transition("action_item","source","approved","manager","verified","2026-10-09T10:00:00.000Z");
 const exported=x.store.exportData("2026-10-09T11:00:00.000Z");
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES('existing','Existing action')").run();
 x.store.transition("action_item","existing","rejected","manager","obsolete","2026-10-09T12:00:00.000Z");
 x.store.importData(exported); x.store.importData(exported);
 assert.deepEqual(Array.from(x.store.db.prepare("SELECT entity_id,from_state,to_state,actor,reason,changed_at FROM review_audit ORDER BY id").all(),row=>({...row})),[
  {entity_id:"source",from_state:"proposed",to_state:"approved",actor:"manager",reason:"verified",changed_at:"2026-10-09T10:00:00.000Z"},
 ]);
 assert.throws(()=>x.store.db.prepare("DELETE FROM review_audit").run(),/append-only/);
}finally{await x.cleanup();}});

test("v1 database with data and audit upgrades to guarded v2",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"em-os-storage-v1-")); const path=join(dir,"store.sqlite"); const v1=new DatabaseSync(path);
 try { v1.exec(`
  CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'2026-10-09T09:00:00.000Z');
  CREATE TABLE action_items(id TEXT PRIMARY KEY,description TEXT NOT NULL,review_state TEXT NOT NULL DEFAULT 'proposed',updated_at TEXT NOT NULL DEFAULT '2026-10-09T09:00:00.000Z') STRICT;
  CREATE TABLE evidence(id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'proposed') STRICT; CREATE TABLE drafts(id TEXT PRIMARY KEY,reviewer_state TEXT NOT NULL DEFAULT 'proposed') STRICT;
  CREATE TABLE review_audit(id INTEGER PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,from_state TEXT NOT NULL,to_state TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,changed_at TEXT NOT NULL) STRICT;
  CREATE TABLE deletion_tombstones(provider TEXT NOT NULL,source_id TEXT NOT NULL,deleted_at TEXT NOT NULL,reason TEXT NOT NULL,content_hash TEXT NOT NULL,PRIMARY KEY(provider,source_id)) STRICT;
  CREATE TRIGGER action_review_guard BEFORE UPDATE OF review_state ON action_items WHEN old.review_state <> new.review_state BEGIN SELECT RAISE(ABORT,'review transition requires audit'); END;
  CREATE TRIGGER evidence_review_guard BEFORE UPDATE OF status ON evidence WHEN old.status <> new.status BEGIN SELECT RAISE(ABORT,'review transition requires audit'); END;
  CREATE TRIGGER draft_review_guard BEFORE UPDATE OF reviewer_state ON drafts WHEN old.reviewer_state <> new.reviewer_state BEGIN SELECT RAISE(ABORT,'review transition requires audit'); END;
  CREATE TRIGGER action_items_initial_review_guard BEFORE INSERT ON action_items WHEN new.review_state <> 'proposed' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
  CREATE TRIGGER evidence_initial_review_guard BEFORE INSERT ON evidence WHEN new.status <> 'proposed' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
  CREATE TRIGGER drafts_initial_review_guard BEFORE INSERT ON drafts WHEN new.reviewer_state <> 'proposed' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
  CREATE TRIGGER review_audit_no_update BEFORE UPDATE ON review_audit BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
  CREATE TRIGGER review_audit_no_delete BEFORE DELETE ON review_audit BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
  INSERT INTO action_items(id,description) VALUES('a1','Existing v1 action');
  INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('action_item','a1','proposed','approved','manager','v1 decision','2026-10-09T10:00:00.000Z');
  INSERT INTO deletion_tombstones VALUES('github','acme/api:42','2026-10-09T10:00:00.000Z','deleted','sha256:v1');
 `); } finally { v1.close(); }
 const upgraded=new SqliteStorage(path); try {
  await upgraded.initialize();
  assert.deepEqual(Array.from(upgraded.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),row=>({...row})),[{version:1},{version:2}]);
  assert.equal((upgraded.db.prepare("SELECT reason FROM deletion_tombstones WHERE provider='github' AND source_id='acme/api:42'").get() as {reason:string}).reason,"deleted");
  assert.equal((upgraded.db.prepare("SELECT actor FROM review_audit WHERE entity_id='a1'").get() as {actor:string}).actor,"manager");
  assert.throws(()=>upgraded.db.prepare("UPDATE action_items SET review_state='rejected' WHERE id='a1'").run(),/requires storage API/);
 } finally { upgraded.close(); await rm(dir,{recursive:true,force:true}); }
});
