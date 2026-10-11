import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { HISTORICAL_V1_SCHEMA_SQL, SqliteStorage } from "./storage.js";

async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),"em-os-storage-"));
 const store=new SqliteStorage(join(dir,"store.sqlite")); await store.initialize();
 return {dir,store,cleanup:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}
const record={id:"github:pr:acme/api:42",provider:"github",sourceId:"acme/api:42",stableUrl:"https://example.invalid/acme/api/pull/42",observedAt:"2026-10-09T09:00:00.000Z",excerpt:"Synthetic review requested",contentHash:"sha256:synthetic",classification:"work",lastSeenAt:"2026-10-09T09:00:00.000Z"};

test("empty database migrates with foreign keys and FTS5",async()=>{const x=await fixture();try{
 // v4 is the next free release-line slot: v2 hardens review writes and v3 upgrades shipped storage objects.
 assert.deepEqual(Array.from(x.store.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(), row=>({...row})),[{version:1},{version:2},{version:3},{version:4}]);
 assert.equal((x.store.db.prepare("PRAGMA foreign_keys").get() as {foreign_keys:number}).foreign_keys,1);
 assert.equal((x.store.db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version,4);
 const schemaObjects=new Set(Array.from(x.store.db.prepare("SELECT name FROM sqlite_master").all() as {name:string}[],row=>row.name));
 assert.equal(schemaObjects.has("review_queue_proposals"),true);
 assert.equal(schemaObjects.has("proposal_review_audit"),true);
 const reviewGuard=(x.store.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='evidence_review_guard'").get() as {sql:string}).sql;
 assert.match(reviewGuard,/em_review_write_mode\(\)/);
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

test("review states require audited API transition and cannot leave terminal state",async()=>{const x=await fixture();try{
 assert.throws(()=>x.store.db.prepare("INSERT INTO action_items(id,description,review_state) VALUES('bad','bad','approved')").run(),/start proposed/);
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES(?,?)").run("a1","Review synthetic PR");
 x.store.db.prepare("INSERT INTO people(id,display_name,identities_json,identity_confirmed) VALUES('p1','Person','[]',1)").run();
 x.store.db.prepare("INSERT INTO evidence(id,subject_person_id,observation,author,observed_at,sensitivity) VALUES('e1','p1','obs','a',?,'private')").run("2026-10-09T09:00:00.000Z");
 x.store.db.prepare("INSERT INTO drafts(id,type,period,audience,input_record_ids_json,generated_at) VALUES('d1','weekly','2026-W41','m','[]',?)").run("2026-10-09T09:00:00.000Z");
 // R1: direct bypass attempts must fail
 assert.throws(()=>x.store.db.prepare("INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('action_item','a1','proposed','approved','intruder','bypass','2026-10-09T10:00:00.000Z')").run(),/may only be written by storage API/);
 assert.throws(()=>x.store.db.prepare("UPDATE action_items SET review_state='approved' WHERE id='a1'").run(),/requires storage API/);
 assert.throws(()=>x.store.db.prepare("UPDATE evidence SET status='approved' WHERE id='e1'").run(),/requires storage API/);
 assert.throws(()=>x.store.db.prepare("UPDATE drafts SET reviewer_state='approved' WHERE id='d1'").run(),/requires storage API/);
 // API transition still succeeds, AFTER-UPDATE trigger writes the audit row exactly once
 x.store.transition("action_item","a1","approved","manager","verified source","2026-10-09T10:00:00.000Z");
 assert.equal((x.store.db.prepare("SELECT review_state FROM action_items WHERE id='a1'").get() as {review_state:string}).review_state,"approved");
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_audit WHERE entity_id='a1'").get() as {n:number}).n,1);
 x.store.transition("evidence","e1","approved","manager","verified evidence","2026-10-09T10:05:00.000Z");
 assert.equal((x.store.db.prepare("SELECT status FROM evidence WHERE id='e1'").get() as {status:string}).status,"approved");
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_audit WHERE entity_type='evidence' AND entity_id='e1'").get() as {n:number}).n,1);
 assert.throws(()=>x.store.transition("action_item","a1","rejected","manager","changed mind","2026-10-09T11:00:00.000Z"),/terminal review state/);
 assert.throws(()=>x.store.db.prepare("DELETE FROM review_audit WHERE entity_id='a1'").run(),/append-only/);
}finally{await x.cleanup();}});

test("historical v1 evidence guard validates status transitions against audit",async()=>{
 const db=new DatabaseSync(":memory:");
 try {
  db.exec(HISTORICAL_V1_SCHEMA_SQL);
  db.exec("INSERT INTO people(id,display_name,identities_json,identity_confirmed) VALUES('p1','Person','[]',1);");
  db.prepare("INSERT INTO evidence(id,subject_person_id,observation,author,observed_at,sensitivity) VALUES('e1','p1','obs','a',?,'private')").run("2026-10-09T09:00:00.000Z");
  db.exec("INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('evidence','e1','proposed','approved','manager','verified','2026-10-09T10:00:00.000Z');");
  db.exec("UPDATE evidence SET status='approved' WHERE id='e1';");
  assert.equal((db.prepare("SELECT status FROM evidence WHERE id='e1'").get() as {status:string}).status,"approved");
 } finally { db.close(); }
});

test("a deletion tombstone prevents stale sync from restoring excerpts",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",observedAt:record.observedAt,records:[record]});
 x.store.deleteSource(record.provider,record.sourceId,"source_deleted","2026-10-10T00:00:00.000Z");
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"later",observedAt:"2026-10-11T00:00:00.000Z",records:[{...record,observedAt:"2026-10-11T00:00:00.000Z",lastSeenAt:"2026-10-11T00:00:00.000Z"}]});
 const row=x.store.db.prepare("SELECT excerpt,deleted_at FROM source_records").get() as {excerpt:null;deleted_at:string};
 assert.equal(row.excerpt,null); assert.equal(row.deleted_at,"2026-10-10T00:00:00.000Z");
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
 assert.equal(envelope.manifest.schemaVersion,4);
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

test("deleted PR metadata is excluded from reads and exports while live PRs round-trip",async()=>{const x=await fixture();try{
 const pr={provider:"github",repository:"acme/api",id:"42",title:"Sensitive deleted title",url:"https://example.invalid/acme/api/pull/42",author:"alice",isDraft:false,reviewRequestedOfViewer:true,ciStatus:"passing" as const,updatedAt:"2026-10-09T09:00:00.000Z"};
 await x.store.savePullRequests([pr],record.observedAt);
 const liveExport=x.store.exportData("2026-10-09T12:00:00.000Z");
 assert.equal(liveExport.tables.prs.length,1);
 const live=await fixture(); try {
  live.store.importData(liveExport);
  assert.equal((await live.store.listPullRequests())[0].title,"Sensitive deleted title");
 } finally { await live.cleanup(); }
 assert.equal((await x.store.listPullRequests()).length,1);
 x.store.deleteSource("github","acme/api:42","source_deleted","2026-10-10T00:00:00.000Z");
 assert.equal((await x.store.listPullRequests()).length,0);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM deletion_tombstones").get() as {n:number}).n,1);
 assert.equal((x.store.db.prepare("SELECT title FROM prs").get() as {title:string}).title,"Sensitive deleted title");
 const deletedExport=x.store.exportData("2026-10-10T01:00:00.000Z");
 assert.deepEqual(deletedExport.tables.prs,[]);
 assert.doesNotMatch(JSON.stringify(deletedExport.tables.prs),/Sensitive deleted title|alice|pull\/42/);
 const restored=await fixture(); try {
  restored.store.importData(deletedExport);
  assert.equal((restored.store.db.prepare("SELECT count(*) n FROM prs").get() as {n:number}).n,0);
  assert.equal((await restored.store.listPullRequests()).length,0);
 } finally { await restored.cleanup(); }
}finally{await x.cleanup();}});

test("timestamps reject local offsets and normalize UTC fixtures",async()=>{const x=await fixture();try{
 assert.throws(()=>x.store.persistSync({connector:"calendar",scope:"synthetic",observedAt:"2026-11-01T01:30:00-04:00",records:[]}),/must be UTC/);
 x.store.persistSync({connector:"calendar",scope:"synthetic",observedAt:"2026-11-01T05:30:00.000Z",records:[]});
 assert.equal((x.store.db.prepare("SELECT last_success_at FROM sync_cursors").get() as {last_success_at:string}).last_success_at,"2026-11-01T05:30:00.000Z");
}finally{await x.cleanup();}});

test("import hardens FTS against tombstoned rows and re-imports over existing deletions",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"c1",observedAt:record.observedAt,records:[record]});
 x.store.deleteSource(record.provider,record.sourceId,"source_deleted","2026-10-10T00:00:00.000Z");
 const exported=x.store.exportData("2026-10-09T11:00:00.000Z");
 x.store.importData(exported);
 x.store.importData(exported);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM deletion_tombstones").get() as {n:number}).n,1);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n,1);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM source_records_fts WHERE source_records_fts MATCH 'review'").get() as {n:number}).n,0);
 x.store.db.exec("INSERT INTO source_records_fts(source_records_fts) VALUES('integrity-check')");
}finally{await x.cleanup();}});

test("import rejects terminal review states without audit",async()=>{const x=await fixture();try{
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES('existing','Existing')").run();
 const exported=x.store.exportData("2026-10-09T11:00:00.000Z");
 exported.tables.action_items.push({id:"bad",description:"bad",review_state:"approved",created_at:"2026-10-09T09:00:00.000Z",updated_at:"2026-10-09T09:00:00.000Z"});
 assert.throws(()=>x.store.importData(exported),/requires exactly one proposed-to-approved audit row|must start proposed/);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM action_items").get() as {n:number}).n,1);
 assert.equal((x.store.db.prepare("SELECT review_state state FROM action_items WHERE id='existing'").get() as {state:string}).state,"proposed");
}finally{await x.cleanup();}});

test("import rejects audit rows with missing or inconsistent entity",async()=>{const x=await fixture();try{
 const exported=x.store.exportData("2026-10-09T11:00:00.000Z");
 exported.tables.review_audit=[{entity_type:"action_item",entity_id:"ghost",from_state:"proposed",to_state:"approved",actor:"x",reason:"x",changed_at:"2026-10-09T10:00:00.000Z"}];
 assert.throws(()=>x.store.importData(exported),/missing action_item ghost/);
}finally{await x.cleanup();}});

test("import requires exact single-transition audit history for every review entity type",async()=>{const x=await fixture();try{
 x.store.db.prepare("INSERT INTO people(id,display_name,identities_json,identity_confirmed) VALUES('p1','Person','[]',1)").run();
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES('a1','Action')").run();
 x.store.db.prepare("INSERT INTO evidence(id,subject_person_id,observation,author,observed_at,sensitivity) VALUES('e1','p1','Observation','a','2026-10-09T09:00:00.000Z','private')").run();
 x.store.db.prepare("INSERT INTO drafts(id,type,period,audience,input_record_ids_json,generated_at) VALUES('d1','weekly','2026-W41','m','[]','2026-10-09T09:00:00.000Z')").run();
 for(const [type,id] of [["action_item","a1"],["evidence","e1"],["draft","d1"]] as const)
  x.store.transition(type,id,"approved","manager","verified","2026-10-09T10:00:00.000Z");
 const valid=x.store.exportData("2026-10-09T11:00:00.000Z");
 x.store.importData(valid);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_audit").get() as {n:number}).n,3);
 for(const [type,id] of [["action_item","a1"],["evidence","e1"],["draft","d1"]] as const) {
  const forged=structuredClone(valid);
  forged.tables.review_audit.push({entity_type:type,entity_id:id,from_state:"rejected",to_state:"approved",actor:"intruder",reason:"forged",changed_at:"2026-10-09T10:30:00.000Z"});
  assert.throws(()=>x.store.importData(forged),/requires exactly one proposed-to-approved audit row/);
  assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_audit").get() as {n:number}).n,3,"invalid import must roll back");
 }
 const proposedWithAudit=structuredClone(valid);
 proposedWithAudit.tables.action_items[0].review_state="proposed";
 assert.throws(()=>x.store.importData(proposedWithAudit),/proposed state has audit history/);
 assert.equal((x.store.db.prepare("SELECT review_state FROM action_items WHERE id='a1'").get() as {review_state:string}).review_state,"approved");
}finally{await x.cleanup();}});

test("import normalises non-UTC timestamps and retention no longer deletes early",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",observedAt:record.observedAt,records:[{...record,retentionUntil:"2026-10-09T13:00:00.000Z"}]});
 const exported=x.store.exportData("2026-10-09T11:00:00.000Z");
 exported.tables.source_records[0].retention_until="2026-10-09T09:00:00-04:00";
 assert.throws(()=>x.store.importData(exported),/must be UTC/);
 exported.tables.source_records[0].retention_until="2026-10-09T13:00:00.000Z";
 x.store.importData(exported);
 assert.equal((x.store.db.prepare("SELECT retention_until FROM source_records").get() as {retention_until:string}).retention_until,"2026-10-09T13:00:00.000Z");
 assert.equal(x.store.applyRetention("2026-10-09T11:00:00.000Z"),0);
 assert.equal(x.store.applyRetention("2026-10-09T15:00:00.000Z"),1);
}finally{await x.cleanup();}});

test("full export fixture round-trips every table and FTS is searchable after restore",async()=>{const x=await fixture();try{
 const observed="2026-10-09T09:00:00.000Z";
 x.store.db.prepare("INSERT INTO people(id,display_name,identities_json,identity_confirmed) VALUES('p1','Person','[]',1)").run();
 x.store.db.prepare("INSERT INTO source_records(id,provider,source_id,stable_url,observed_at,excerpt,content_hash,classification,last_seen_at,retention_until) VALUES('s1','github','g/1','https://example.invalid/1',?,'retained excerpt','h1','work',?,?)").run(observed,observed,"2026-10-12T00:00:00.000Z");
 x.store.db.prepare("INSERT INTO sync_cursors(connector,scope,cursor,watermark,last_success_at,fetched_count) VALUES('github','g','c1','w1',?,5)").run(observed);
 x.store.db.prepare("INSERT INTO prs(id,source_record_id,provider,repository,source_id,author,title,url,updated_at,is_draft,ci_status,review_requested,last_relevant_activity_at) VALUES('pr1','s1','github','g','1','a','T','https://example.invalid/1',?,0,'passing',1,?)").run(observed,observed);
 x.store.db.prepare("INSERT INTO initiatives(id,title,deadline) VALUES('i1','Initiative','2026-10-31T00:00:00.000Z')").run();
 x.store.db.prepare("INSERT INTO action_items(id,description,owner_person_id) VALUES('ai1','Action','p1')").run();
 x.store.transition("action_item","ai1","approved","manager","verified",observed);
 x.store.db.prepare("INSERT INTO action_item_sources(action_item_id,source_record_id) VALUES('ai1','s1')").run();
 x.store.db.prepare("INSERT INTO evidence(id,subject_person_id,observation,author,observed_at,sensitivity) VALUES('e1','p1','Observation','manager',?,'private')").run(observed);
 x.store.db.prepare("INSERT INTO evidence_sources(evidence_id,source_record_id) VALUES('e1','s1')").run();
 x.store.db.prepare("INSERT INTO drafts(id,type,period,audience,input_record_ids_json,generated_at) VALUES('d1','weekly','2026-W41','manager','[\"s1\"]',?)").run(observed);
 x.store.db.prepare("INSERT INTO draft_sources(draft_id,source_record_id) VALUES('d1','s1')").run();
 x.store.db.prepare("INSERT INTO cache_entries(cache_key,source_record_id,value) VALUES('k','s1','v')").run();
 const exported=x.store.exportData("2026-10-09T12:00:00.000Z");
 const exportPath=join(x.dir,"export.json"); await writeFile(exportPath,JSON.stringify(exported,null,2),{encoding:"utf8",mode:0o600});
 const restored=await SqliteStorage.restoreFromExport(join(x.dir,"roundtrip.sqlite"),exportPath);
 try {
  const equalize=(rows:Record<string,unknown>[])=>rows.map(r=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))));
  for (const table of ["people","source_records","sync_cursors","prs","initiatives","action_items","action_item_sources","evidence","evidence_sources","drafts","draft_sources","review_audit","deletion_tombstones"]) {
   const before=equalize(x.store.db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[]);
   const after=equalize(restored.db.prepare(`SELECT * FROM ${table}`).all() as Record<string,unknown>[]);
   assert.deepEqual(after,before,`table ${table} differs after import`);
  }
  assert.equal((restored.db.prepare("SELECT count(*) n FROM cache_entries").get() as {n:number}).n,0);
  assert.equal((restored.db.prepare("SELECT count(*) n FROM source_records_fts WHERE source_records_fts MATCH 'retained'").get() as {n:number}).n,1);
 } finally { restored.close(); }
}finally{await x.cleanup();}});

test("newer schema database is rejected and user_version is set",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"em-os-storage-newer-")); const path=join(dir,"store.sqlite"); const db=new DatabaseSync(path);
 try { db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(99,'2026-10-09T09:00:00.000Z');"); } finally { db.close(); }
 const s=new SqliteStorage(path);
 try {
  await assert.rejects(()=>s.initialize(),/schema version 99 is newer than supported/);
 } finally { s.close(); await rm(dir,{recursive:true,force:true}); }
});

test("import over audited DB round-trips review_audit and preserves append-only guard outside import",async()=>{const x=await fixture();try{
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES('a1','x')").run();
 x.store.transition("action_item","a1","approved","manager","ok","2026-10-09T10:00:00.000Z");
 const exported=x.store.exportData("2026-10-09T11:00:00.000Z");
 const beforeAudit=equalize(x.store.db.prepare("SELECT * FROM review_audit").all() as Record<string,unknown>[]);
 x.store.importData(exported);
 const afterAudit=equalize(x.store.db.prepare("SELECT * FROM review_audit").all() as Record<string,unknown>[]);
 assert.deepEqual(afterAudit,beforeAudit);
 // outside import, audit rows remain append-only
 assert.throws(()=>x.store.db.prepare("DELETE FROM review_audit WHERE entity_id='a1'").run(),/append-only/);
 assert.throws(()=>x.store.db.prepare("UPDATE review_audit SET reason='tampered' WHERE entity_id='a1'").run(),/append-only/);
}finally{await x.cleanup();}});

const HISTORICAL_V2_SCHEMA_SQL = `
DROP TRIGGER action_review_guard;
DROP TRIGGER evidence_review_guard;
DROP TRIGGER draft_review_guard;
DROP TRIGGER action_items_initial_review_guard;
DROP TRIGGER evidence_initial_review_guard;
DROP TRIGGER drafts_initial_review_guard;
CREATE TRIGGER action_items_initial_review_guard BEFORE INSERT ON action_items WHEN new.review_state <> 'proposed' AND em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE TRIGGER evidence_initial_review_guard BEFORE INSERT ON evidence WHEN new.status <> 'proposed' AND em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
CREATE TRIGGER drafts_initial_review_guard BEFORE INSERT ON drafts WHEN new.reviewer_state <> 'proposed' AND em_review_write_mode() <> 'import' BEGIN SELECT RAISE(ABORT,'review entities must start proposed'); END;
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
ALTER TABLE deletion_tombstones RENAME TO deletion_tombstones_v1;
CREATE TABLE deletion_tombstones (provider TEXT NOT NULL,source_id TEXT NOT NULL,deleted_at TEXT NOT NULL,reason TEXT NOT NULL,content_hash TEXT,PRIMARY KEY(provider,source_id)) STRICT;
INSERT INTO deletion_tombstones SELECT * FROM deletion_tombstones_v1;
DROP TABLE deletion_tombstones_v1;
`;

async function assertHistoricalUpgrade(version:1|2):Promise<void> {
 const dir=await mkdtemp(join(tmpdir(),`em-os-storage-v${version}-`)); const path=join(dir,"store.sqlite");
 const db=new DatabaseSync(path); db.function("em_review_write_mode",()=>"none"); db.function("em_review_actor",()=>""); db.function("em_review_reason",()=>""); db.function("em_review_changed_at",()=>"");
 try {
  db.exec(`CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); ${HISTORICAL_V1_SCHEMA_SQL}`);
  db.prepare("INSERT INTO schema_migrations VALUES(1,?)").run("2026-10-09T09:00:00.000Z");
  if(version===2){db.exec(HISTORICAL_V2_SCHEMA_SQL);db.prepare("INSERT INTO schema_migrations VALUES(2,?)").run("2026-10-09T10:00:00.000Z");}
  db.prepare("INSERT INTO action_items(id,description) VALUES('a1','migrate me')").run();
  db.prepare("INSERT INTO source_records(id,provider,source_id,observed_at,excerpt,content_hash,classification,last_seen_at,deleted_at,deletion_reason) VALUES('s1','github','acme/1',?,'old text','h','work',?,?,'deleted')").run("2026-10-09T09:00:00.000Z","2026-10-09T09:00:00.000Z","2026-10-10T00:00:00.000Z");
  db.prepare("INSERT INTO deletion_tombstones(provider,source_id,deleted_at,reason,content_hash) VALUES('github','acme/1',?,'deleted','h')").run("2026-10-10T00:00:00.000Z");
 } finally { db.close(); }
 const store=new SqliteStorage(path);
 try {
  await store.initialize();
  assert.deepEqual(Array.from(store.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),r=>({...r})),[{version:1},{version:2},{version:3},{version:4}]);
  const trigger=(store.db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='source_records_ad'").get() as {sql:string}).sql;
  assert.match(trigger,/WHEN old\.deleted_at IS NULL/);
  for(const index of ["prs_source_record_idx","action_items_owner_idx","action_item_sources_source_idx","evidence_subject_idx","evidence_supersedes_idx","evidence_sources_source_idx","draft_sources_source_idx","cache_entries_source_idx"])
   assert.ok(store.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name=?").get(index),`missing ${index}`);
  const tombstoneInfo=store.db.prepare("PRAGMA table_info(deletion_tombstones)").all() as {name:string;notnull:number}[];
  assert.equal(tombstoneInfo.find(c=>c.name==="content_hash")?.notnull,0);
  assert.throws(()=>store.db.prepare("INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('action_item','a1','proposed','approved','x','x','2026-10-09T11:00:00.000Z')").run(),/may only be written by storage API/);
  assert.throws(()=>store.db.prepare("UPDATE action_items SET review_state='approved' WHERE id='a1'").run(),/requires storage API/);
  store.transition("action_item","a1","approved","manager","verified","2026-10-09T11:00:00.000Z");
  const exported=store.exportData("2026-10-09T12:00:00.000Z"); store.importData(exported); store.importData(exported);
  store.db.exec("INSERT INTO source_records_fts(source_records_fts) VALUES('integrity-check')");
  assert.equal((store.db.prepare("SELECT count(*) n FROM review_audit").get() as {n:number}).n,1);
 } finally {store.close();await rm(dir,{recursive:true,force:true});}
}

test("literal historical v1 upgrades through every forward migration",()=>assertHistoricalUpgrade(1));
test("literal historical v2 tombstone schema upgrades through current",()=>assertHistoricalUpgrade(2));

function equalize(rows:Record<string,unknown>[]) {
 return rows.map(r=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b))));
}
