// G-SEC-02 encrypted backup/restore drill (synthetic only).
// Evidence for ADR 0008 / gate G-SEC-02 / SECURITY_REVIEW.md SEC-04.
// Exercises the two real artifacts named in ADR 0008 decision #2:
//   (A) backupToEncrypted(): node:sqlite backup() -> AES-256-GCM header-AAD envelope -> restore into fresh DB
//   (B) writeExport(): em-os-storage JSON export -> AES-256-GCM header-AAD envelope -> importData()-equivalent restore
// Plus on-disk plaintext controls, tamper/wrong-key/absent-key rejection,
// M1/M2 header-AAD negative checks, and the documented PBKDF2 operator-passphrase fallback. No network; reserved.test fixtures only.
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage, BackupEnvelopeError, recomputeHeaderAAD } from "../packages/core/dist/storage.js";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail ?? "" });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
async function rejects(name, fn) {
  try { await fn(); check(name, false, "did not throw"); }
  catch (e) { const typed = e instanceof BackupEnvelopeError || /EnvelopeValidationError|auth|tag|Unable to authenticate/i.test(String(e)); check(name, typed, String(e).slice(0, 80)); }
}

const dir = await mkdtemp(join(tmpdir(), "em-os-drill-"));
const keyMaterial = Buffer.from("synthetic drill os key material 32", "utf8");
const keySource = { getKeyMaterial: () => keyMaterial };

try {
  await mkdir(join(dir, "backups"), { recursive: true });

  // ---- Populate a synthetic source DB (same shape as the v1 storage schema) ----
  const dbPath = join(dir, "source.sqlite");
  const source = new SqliteStorage(dbPath); await source.initialize();
  source.db.prepare("INSERT INTO people (id, display_name, role) VALUES (?, ?, ?)").run("p1", "Reserved Person", "synthetic-role");
  source.db.prepare("INSERT INTO people (id, display_name, role) VALUES (?, ?, ?)").run("p2", "Example User", "synthetic-role");
  const insR = source.db.prepare("INSERT INTO source_records (id, provider, source_id, stable_url, observed_at, content_hash, classification, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (let i = 1; i <= 25; i += 1) insR.run(`r${i}`, "synthetic", `id-${i}`, `https://example.invalid/r${i}`, "2026-10-09T09:00:00.000Z", `hash-${i}`, "work", "2026-10-09T09:00:00.000Z");
  const srcCounts = {
    people: source.db.prepare("SELECT COUNT(*) AS n FROM people").get().n,
    records: source.db.prepare("SELECT COUNT(*) AS n FROM source_records").get().n,
  };
  check("synthetic source DB populated", srcCounts.people === 2 && srcCounts.records === 25, JSON.stringify(srcCounts));

  // ---- (A) backupToEncrypted(): SQLite backup() -> envelope of the sqlite backup copy --
  const backupPath = join(dir, "backups", "drill-backup.enc.json");
  await source.backupToEncrypted(backupPath, keySource);
  const envA = JSON.parse(await readFile(backupPath, "utf8"));
  check("(A) envelope written to disk (0o600)", envA.format === "em-os-enc-backup" && envA.artifact === "sqlite-backup");
  check("(A) envelope schema fields deterministic", envA.version === 1 && envA.schema_version === 1 && envA.cipher === "AES-256-GCM" && envA.kdf.alg === "HKDF-SHA-256" && envA.kdf.info === "em-os backup key v1" && envA.kdf.dkLen === 32 && envA.kdf.source === "os-keystore" && typeof envA.aad_b64 === "string" && envA.aad_b64.length > 0);

  const markers = ["CREATE TABLE", "source_records", "Reserved Person", "synthetic excerpt"];
  const envAOnDisk = (await readFile(backupPath)).toString("utf8");
  const leakedEnv = markers.filter((m) => envAOnDisk.includes(m));
  check("(A) no plaintext schema/markers on disk", leakedEnv.length === 0, leakedEnv.length ? `leaked: ${leakedEnv.join(", ")}` : "");

  // Restore (A): decrypt -> sqlite bytes -> fresh DB -> counts + integrity.
  const restoredA = await SqliteStorage.restoreFromEncryptedBackup(backupPath, join(dir, "restored-a.sqlite"), keySource);
  const restCountsA = {
    people: restoredA.db.prepare("SELECT COUNT(*) AS n FROM people").get().n,
    records: restoredA.db.prepare("SELECT COUNT(*) AS n FROM source_records").get().n,
  };
  const integrityA = restoredA.db.prepare("PRAGMA integrity_check").get().integrity_check;
  const restPeopleA = restoredA.db.prepare("SELECT id, display_name FROM people ORDER BY id").all().map((p) => ({ id: p.id, display_name: p.display_name }));
  check("(A) restored DB opens and counts match source", restCountsA.people === srcCounts.people && restCountsA.records === srcCounts.records, JSON.stringify(restCountsA));
  check("(A) restored PRAGMA integrity_check ok", integrityA === "ok", integrityA);
  check("(A) restored record content equals source", JSON.stringify(restPeopleA) === JSON.stringify([{ id: "p1", display_name: "Reserved Person" }, { id: "p2", display_name: "Example User" }]));
  restoredA.close();

  // ---- (B) writeExport(): em-os-storage JSON export -> envelope -> import ------------
  const exportPath = join(dir, "backups", "drill-export.enc.json");
  await source.writeExport(exportPath, keySource);
  const envB = JSON.parse(await readFile(exportPath, "utf8"));
  check("(B) envelope written to disk (0o600)", envB.format === "em-os-enc-backup" && envB.artifact === "em-os-storage");
  check("(B) aad_b64 equals recomputed canonical header AAD", envB.aad_b64 === recomputeHeaderAAD(envB).toString("base64"));
  const restoredB = await SqliteStorage.restoreFromExport(exportPath, join(dir, "restored-b.sqlite"), keySource);
  const restCountsB = {
    people: restoredB.db.prepare("SELECT COUNT(*) AS n FROM people").get().n,
    records: restoredB.db.prepare("SELECT COUNT(*) AS n FROM source_records").get().n,
  };
  check("(B) restored DB counts match source", restCountsB.people === srcCounts.people && restCountsB.records === srcCounts.records, JSON.stringify(restCountsB));
  restoredB.close();

  // ---- Fail-closed: tamper, wrong key, absent key -----------------------------
  let tamperRejected = false;
  try {
    const tampered = JSON.parse(JSON.stringify(envB));
    const raw = Buffer.from(tampered.inner, "base64");
    raw[raw.length - 1] ^= 0x01;
    tampered.inner = raw.toString("base64");
    await SqliteStorage.restoreFromExport(tampered, join(dir, "ignored.sqlite"), keySource);
  } catch { tamperRejected = true; }
  check("tampered ciphertext rejected (GCM tag)", tamperRejected);
  let wrongKeyRejected = false;
  try {
    await SqliteStorage.restoreFromExport(exportPath, join(dir, "ignored.sqlite"), { getKeyMaterial: () => randomMaterial(32) });
  } catch { wrongKeyRejected = true; }
  check("wrong OS keystore secret rejected", wrongKeyRejected);
  let absentKeyRejected = false;
  try { await source.writeExport(join(dir, "backups", "absent.enc.json"), { getKeyMaterial: () => { throw new Error("no key"); } }); } catch { absentKeyRejected = true; }
  check("fail-closed when OS key material absent", absentKeyRejected);

  // ---- M1/M2 header-AAD negative checks ---------------------------------------
  const mutateAAD = (envelope, mutate) => { const e = JSON.parse(JSON.stringify(envelope)); mutate(e); e.aad_b64 = recomputeHeaderAAD(e).toString("base64"); return e; };
  await rejects("M2 rejects bogus cipher", async () => SqliteStorage.restoreFromExport(mutateAAD(envB, (e) => { e.cipher = "AES-128-CBC"; }), join(dir, "ignored.sqlite"), keySource));
  await rejects("M2 rejects wrong format", async () => SqliteStorage.restoreFromExport(mutateAAD(envB, (e) => { e.format = "em-os-enc"; }), join(dir, "ignored.sqlite"), keySource));
  await rejects("M2 rejects version 2", async () => SqliteStorage.restoreFromExport(mutateAAD(envB, (e) => { e.version = 2; }), join(dir, "ignored.sqlite"), keySource));
  await rejects("M2 rejects schema_version 2", async () => SqliteStorage.restoreFromExport(mutateAAD(envB, (e) => { e.schema_version = 2; }), join(dir, "ignored.sqlite"), keySource));
  await rejects("M2 rejects unknown artifact", async () => SqliteStorage.restoreFromExport(mutateAAD(envB, (e) => { e.artifact = "unknown-artifact"; }), join(dir, "ignored.sqlite"), keySource));
  await rejects("M2 rejects v0 envelope missing aad_b64", async () => { const e = JSON.parse(JSON.stringify(envB)); delete e.aad_b64; await SqliteStorage.restoreFromExport(e, join(dir, "ignored.sqlite"), keySource); });
  await rejects("M2-D rejects aad_b64 mismatch", async () => { const e = JSON.parse(JSON.stringify(envB)); e.aad_b64 = Buffer.from("tampered").toString("base64"); await SqliteStorage.restoreFromExport(e, join(dir, "ignored.sqlite"), keySource); });
  await rejects("M1 rejects artifact swap without AAD update", async () => { const e = JSON.parse(JSON.stringify(envB)); e.artifact = "sqlite-backup"; await SqliteStorage.restoreFromExport(e, join(dir, "ignored.sqlite"), keySource); });

  // ---- Fallback envelope: PBKDF2-HMAC-SHA-256 operator passphrase -------------
  const fallbackPass = "synthetic operator passphrase (reserved.test)";
  const fallbackSource = { kind: "pbkdf2", passphrase: fallbackPass };
  const fallbackExportPath = join(dir, "backups", "drill-export-fallback.enc.json");
  await source.writeExport(fallbackExportPath, fallbackSource);
  const envF = JSON.parse(await readFile(fallbackExportPath, "utf8"));
  check("(F) fallback envelope recorded with PBKDF2 + iterations", envF.kdf.alg === "PBKDF2-HMAC-SHA256" && envF.kdf.iterations === 600000 && envF.kdf.source === "operator-passphrase");
  const restoredF = await SqliteStorage.restoreFromExport(fallbackExportPath, join(dir, "restored-f.sqlite"), fallbackSource);
  check("(F) fallback envelope round-trip restores tables", restoredF.db.prepare("SELECT COUNT(*) AS n FROM people").get().n === 2);
  restoredF.close();
  let wrongPassRejected = false;
  try { await SqliteStorage.restoreFromExport(fallbackExportPath, join(dir, "ignored.sqlite"), { kind: "pbkdf2", passphrase: "wrong passphrase" }); } catch { wrongPassRejected = true; }
  check("(F) wrong passphrase rejected", wrongPassRejected);
} finally {
  await rm(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\ndrill summary: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  console.error("DRILL FAILED — G-SEC-02 evidence incomplete");
  process.exit(1);
}
console.log("encrypted backup/restore drill: PASS (synthetic fixtures only)");

function randomMaterial(size) { return Buffer.from(Array.from({ length: size }, () => Math.floor(Math.random() * 256))); }
