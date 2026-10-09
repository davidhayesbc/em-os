import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteStorage } from "./storage.js";

async function fixture() {
 const dir=await mkdtemp(join(tmpdir(),"em-os-storage-"));
 const store=new SqliteStorage(join(dir,"store.sqlite")); await store.initialize();
 return {dir,store,cleanup:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}
const record={id:"github:pr:acme/api:42",provider:"github",sourceId:"acme/api:42",stableUrl:"https://example.invalid/acme/api/pull/42",observedAt:"2026-10-09T09:00:00.000Z",excerpt:"Synthetic review requested",contentHash:"sha256:synthetic",classification:"work",lastSeenAt:"2026-10-09T09:00:00.000Z"};

test("empty database migrates with foreign keys and FTS5",async()=>{const x=await fixture();try{
 assert.deepEqual(Array.from(x.store.db.prepare("SELECT version FROM schema_migrations").all(), row=>({...row})),[{version:1},{version:2}]);
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

test("review states require audited API transition and cannot leave terminal state",async()=>{const x=await fixture();try{
 assert.throws(()=>x.store.db.prepare("INSERT INTO action_items(id,description,review_state) VALUES('bad','bad','approved')").run(),/start proposed/);
 x.store.db.prepare("INSERT INTO action_items(id,description) VALUES(?,?)").run("a1","Review synthetic PR");
 assert.throws(()=>x.store.db.prepare("UPDATE action_items SET review_state='approved' WHERE id='a1'").run(),/requires audit/);
 x.store.transition("action_item","a1","approved","manager","verified source","2026-10-09T10:00:00.000Z");
 assert.equal((x.store.db.prepare("SELECT review_state FROM action_items WHERE id='a1'").get() as {review_state:string}).review_state,"approved");
 assert.throws(()=>x.store.transition("action_item","a1","rejected","manager","changed mind","2026-10-09T11:00:00.000Z"),/terminal review state/);
 x.store.db.prepare("INSERT INTO review_audit(entity_type,entity_id,from_state,to_state,actor,reason,changed_at) VALUES('action_item','a1','approved','rejected','intruder','bypass','2026-10-09T11:00:00.000Z')").run();
 assert.throws(()=>x.store.db.prepare("UPDATE action_items SET review_state='rejected' WHERE id='a1'").run(),/terminal review state/);
 assert.equal((x.store.db.prepare("SELECT count(*) n FROM review_audit WHERE entity_id='a1'").get() as {n:number}).n,2);
 assert.throws(()=>x.store.db.prepare("DELETE FROM review_audit WHERE entity_id='a1'").run(),/append-only/);
}finally{await x.cleanup();}});

test("a deletion tombstone prevents stale sync from restoring excerpts",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",observedAt:record.observedAt,records:[record]});
 x.store.deleteSource(record.provider,record.sourceId,"source_deleted","2026-10-10T00:00:00.000Z");
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"later",observedAt:"2026-10-11T00:00:00.000Z",records:[{...record,observedAt:"2026-10-11T00:00:00.000Z",lastSeenAt:"2026-10-11T00:00:00.000Z"}]});
 const row=x.store.db.prepare("SELECT excerpt,deleted_at FROM source_records").get() as {excerpt:null;deleted_at:string};
 assert.equal(row.excerpt,null); assert.equal(row.deleted_at,"2026-10-10T00:00:00.000Z");
}finally{await x.cleanup();}});

test("versioned export/import and SQLite backup restore data",async()=>{const x=await fixture();try{
 x.store.persistSync({connector:"github",scope:"acme/api",cursor:"c1",observedAt:record.observedAt,records:[record]});
 const exportPath=join(x.dir,"backup","export.json"); await x.store.writeExport(exportPath);
 const parsed=JSON.parse(await readFile(exportPath,"utf8")); assert.equal(parsed.version,1);
 const restored=await SqliteStorage.restoreFromExport(join(x.dir,"restored.sqlite"),exportPath);
 assert.equal((restored.db.prepare("SELECT count(*) n FROM source_records").get() as {n:number}).n,1); restored.close();
 const backupPath=join(x.dir,"backup","store.sqlite"); await x.store.backupTo(backupPath);
 const backup=new SqliteStorage(backupPath); await backup.initialize(); assert.equal((backup.db.prepare("SELECT cursor FROM sync_cursors").get() as {cursor:string}).cursor,"c1"); backup.close();
}finally{await x.cleanup();}});

test("timestamps reject local offsets and normalize UTC fixtures",async()=>{const x=await fixture();try{
 assert.throws(()=>x.store.persistSync({connector:"calendar",scope:"synthetic",observedAt:"2026-11-01T01:30:00-04:00",records:[]}),/must be UTC/);
 x.store.persistSync({connector:"calendar",scope:"synthetic",observedAt:"2026-11-01T05:30:00.000Z",records:[]});
 assert.equal((x.store.db.prepare("SELECT last_success_at FROM sync_cursors").get() as {last_success_at:string}).last_success_at,"2026-11-01T05:30:00.000Z");
}finally{await x.cleanup();}});
