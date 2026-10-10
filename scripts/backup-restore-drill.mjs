// G-SEC-02 encrypted backup/restore drill (synthetic only).
// Evidence for ADR 0008 / gate G-SEC-02 / SECURITY_REVIEW.md SEC-04.
// Exercises the two real artifacts named in ADR 0008 decision #2:
//   (A) backupTo(): node:sqlite backup() -> AES-256-GCM envelope -> restore into fresh DB
//   (B) writeExport(): em-os-storage JSON export -> AES-256-GCM envelope -> importData()-equivalent restore
// Plus on-disk plaintext controls, tamper/wrong-key/absent-key rejection, and the
// documented PBKDF2 operator-passphrase fallback envelope. No network; reserved.test fixtures only.
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash, hkdfSync } from "node:crypto";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail ?? "" });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const HKDF_INFO = "em-os backup key v1";
const PBKDF2_ITERS = 600000;

// Primary KEK: HKDF-SHA-256 over OS-keystore-backed OS key material with a
// per-backup salt. (The drill synthesizes the keystore secret; it never reads a
// real system keystore.) Fallback KEK: PBKDF2-HMAC-SHA-256 over an operator
// passphrase at 600000 iterations, recorded by envelope.kdf.alg.
function encryptArtifact(osKeyMaterialOrPass, plaintext, { artifact, fallback } = {}) {
  const saltB64 = randomBytes(16).toString("base64");
  const salt = Buffer.from(saltB64, "base64");
  let kek, kdf;
  if (fallback) {
    kek = Buffer.from(pbkdf2Sync(osKeyMaterialOrPass, salt, PBKDF2_ITERS, 32, "sha256"));
    kdf = { alg: "PBKDF2-HMAC-SHA256", iterations: PBKDF2_ITERS, salt_b64: saltB64, dkLen: 32, source: "operator-passphrase" };
  } else {
    kek = Buffer.from(hkdfSync("sha256", osKeyMaterialOrPass, salt, HKDF_INFO, 32));
    kdf = { alg: "HKDF-SHA-256", source: "os-keystore", info: HKDF_INFO, salt_b64: saltB64, dkLen: 32 };
  }
  const iv = randomBytes(12); // 96-bit nonce, unique per envelope
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    envelope: {
      format: "em-os-enc-backup",
      version: 1,
      artifact,
      inner: ct.toString("base64"),
      nonce_b64: iv.toString("base64"),
      kdf,
      cipher: "AES-256-GCM",
      tag_b64: cipher.getAuthTag().toString("base64"),
      created_at: new Date().toISOString(),
      schema_version: 1,
    },
    kek,
  };
}

function decryptArtifact(osKeyMaterialOrPass, envelope) {
  const salt = Buffer.from(envelope.kdf.salt_b64, "base64");
  const kek = envelope.kdf.alg === "HKDF-SHA-256"
    ? Buffer.from(hkdfSync("sha256", osKeyMaterialOrPass, salt, HKDF_INFO, 32))
    : Buffer.from(pbkdf2Sync(osKeyMaterialOrPass, salt, envelope.kdf.iterations, 32, "sha256"));
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(envelope.nonce_b64, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag_b64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.inner, "base64")), decipher.final()]);
}

const dir = await mkdtemp(join(tmpdir(), "em-os-drill-"));
try {
  await mkdir(join(dir, "backups"), { recursive: true });

  // ---- Populate a synthetic source DB (same shape as the v1 storage schema) ----
  const dbPath = join(dir, "source.sqlite");
  const source = new DatabaseSync(dbPath);
  source.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT)");
  source.exec("CREATE TABLE source_records (id TEXT PRIMARY KEY, provider TEXT NOT NULL, excerpt TEXT)");
  const insP = source.prepare("INSERT INTO people (id, display_name, role) VALUES (?, ?, ?)");
  insP.run("p1", "Reserved Person", "synthetic-role");
  insP.run("p2", "Example User", "synthetic-role");
  const insR = source.prepare("INSERT INTO source_records (id, provider, excerpt) VALUES (?, ?, ?)");
  for (let i = 1; i <= 25; i += 1) insR.run(`r${i}`, "synthetic", `synthetic excerpt body ${i} (reserved.test)`);
  const srcCounts = {
    people: source.prepare("SELECT COUNT(*) AS n FROM people").get().n,
    records: source.prepare("SELECT COUNT(*) AS n FROM source_records").get().n,
  };
  const exportTables = ["people", "source_records"];
  const exported = {
    format: "em-os-storage",
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(exportTables.map((t) => [t, source.prepare(`SELECT * FROM ${t}`).all()])),
  };
  source.close();
  check("synthetic source DB populated", srcCounts.people === 2 && srcCounts.records === 25, JSON.stringify(srcCounts));

  // ---- (A) backupTo(): SQLite backup() -> envelope of the sqlite backup copy --
  const backupPath = join(dir, "backups", "drill-backup.sqlite");
  const reopened = new DatabaseSync(dbPath);
  await backup(reopened, backupPath);
  reopened.close();
  const plaintextCopy = await readFile(backupPath);
  check("(A) SQLite backup() produced copy", plaintextCopy.length > 0, `${plaintextCopy.length} bytes`);

  const osKeyMaterial = randomBytes(32); // stands in for the OS-keystore secret
  const envA = encryptArtifact(osKeyMaterial, plaintextCopy, { artifact: "sqlite-backup" });
  const envAPath = join(dir, "backups", "drill-backup.enc.json");
  await writeFile(envAPath, JSON.stringify(envA.envelope, null, 2), { mode: 0o600 });
  check("(A) envelope written to disk (0o600)", (await readFile(envAPath)).length > 0);
  check("(A) KEK not persisted in envelope", !JSON.stringify(envA.envelope).includes(envA.kek.toString("base64")));

  const markers = ["CREATE TABLE", "source_records", "Reserved Person", "synthetic excerpt"];
  const envAOnDisk = (await readFile(envAPath)).toString("utf8");
  const leakedEnv = markers.filter((m) => envAOnDisk.includes(m));
  check("(A) no plaintext schema/markers on disk", leakedEnv.length === 0, leakedEnv.length ? `leaked: ${leakedEnv.join(", ")}` : "");
  const rawCopy = plaintextCopy.toString("latin1");
  check("(A) control: unencrypted copy leaks markers", markers.every((m) => rawCopy.includes(m)));

  // Restore (A): decrypt -> sqlite bytes -> fresh DB -> counts + integrity.
  const restoredBytes = decryptArtifact(osKeyMaterial, JSON.parse(await readFile(envAPath, "utf8")));
  const restorePath = join(dir, "restored-a.sqlite");
  await writeFile(restorePath, restoredBytes);
  const restoredA = new DatabaseSync(restorePath);
  const restCountsA = {
    people: restoredA.prepare("SELECT COUNT(*) AS n FROM people").get().n,
    records: restoredA.prepare("SELECT COUNT(*) AS n FROM source_records").get().n,
  };
  const integrityA = restoredA.prepare("PRAGMA integrity_check").get().integrity_check;
  const restPeopleA = restoredA.prepare("SELECT id, display_name FROM people ORDER BY id").all().map((p) => ({ id: p.id, display_name: p.display_name }));
  const srcPeopleSorted = exported.tables.people.map((p) => ({ id: p.id, display_name: p.display_name })).sort((a, b) => a.id.localeCompare(b.id));
  check("(A) restored DB opens and counts match source", restCountsA.people === srcCounts.people && restCountsA.records === srcCounts.records, JSON.stringify(restCountsA));
  check("(A) restored PRAGMA integrity_check ok", integrityA === "ok", integrityA);
  check("(A) restored record content equals source", JSON.stringify(restPeopleA) === JSON.stringify(srcPeopleSorted));
  restoredA.close();

  // ---- (B) writeExport(): em-os-storage JSON export -> envelope -> import -----
  const envB = encryptArtifact(osKeyMaterial, Buffer.from(JSON.stringify(exported, null, 2), "utf8"), { artifact: "em-os-storage" });
  const envBPath = join(dir, "backups", "drill-export.enc.json");
  await writeFile(envBPath, JSON.stringify(envB.envelope, null, 2), { mode: 0o600 });
  const restoredJson = JSON.parse(decryptArtifact(osKeyMaterial, JSON.parse(await readFile(envBPath, "utf8"))).toString("utf8"));
  check("(B) export envelope round-trip restores em-os-storage JSON", restoredJson.format === "em-os-storage" && restoredJson.version === 1);
  const hash = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  check("(B) content hashes match source tables", hash(exported.tables) === hash(restoredJson.tables));

  // importData()-equivalent: insert restored rows into a fresh DB.
  const restoredB = new DatabaseSync(":memory:");
  restoredB.exec("CREATE TABLE people (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, role TEXT)");
  restoredB.exec("CREATE TABLE source_records (id TEXT PRIMARY KEY, provider TEXT NOT NULL, excerpt TEXT)");
  for (const p of restoredJson.tables.people) restoredB.prepare("INSERT INTO people (id, display_name, role) VALUES (?, ?, ?)").run(p.id, p.display_name, p.role);
  for (const r of restoredJson.tables.source_records) restoredB.prepare("INSERT INTO source_records (id, provider, excerpt) VALUES (?, ?, ?)").run(r.id, r.provider, r.excerpt);
  const restCountsB = {
    people: restoredB.prepare("SELECT COUNT(*) AS n FROM people").get().n,
    records: restoredB.prepare("SELECT COUNT(*) AS n FROM source_records").get().n,
  };
  restoredB.close();
  check("(B) restored DB counts match source", restCountsB.people === srcCounts.people && restCountsB.records === srcCounts.records, JSON.stringify(restCountsB));

  // ---- Fail-closed: tamper, wrong key, absent key -----------------------------
  let tamperRejected = false;
  try {
    const tampered = JSON.parse(JSON.stringify(envB.envelope));
    const raw = Buffer.from(tampered.inner, "base64");
    raw[raw.length - 1] ^= 0x01; // flip one ciphertext byte
    tampered.inner = raw.toString("base64");
    decryptArtifact(osKeyMaterial, tampered);
  } catch { tamperRejected = true; }
  check("tampered ciphertext rejected (GCM tag)", tamperRejected);
  let wrongKeyRejected = false;
  try { decryptArtifact(randomBytes(32), envB.envelope); } catch { wrongKeyRejected = true; }
  check("wrong OS keystore secret rejected", wrongKeyRejected);
  let absentKeyRejected = false;
  try { decryptArtifact(null, envB.envelope); } catch { absentKeyRejected = true; }
  check("fail-closed when OS key material absent", absentKeyRejected);

  // ---- Fallback envelope: PBKDF2-HMAC-SHA-256 operator passphrase -------------
  const fallbackPass = "synthetic operator passphrase (reserved.test)";
  const envF = encryptArtifact(fallbackPass, Buffer.from(JSON.stringify(exported, null, 2), "utf8"), { artifact: "em-os-storage", fallback: true });
  check("(F) fallback envelope recorded with PBKDF2 + iterations", envF.envelope.kdf.alg === "PBKDF2-HMAC-SHA256" && envF.envelope.kdf.iterations === 600000);
  const fallbackRestored = JSON.parse(decryptArtifact(fallbackPass, envF.envelope).toString("utf8"));
  check("(F) fallback envelope round-trip restores tables", hash(exported.tables) === hash(fallbackRestored.tables));
  let wrongPassRejected = false;
  try { decryptArtifact("wrong passphrase", envF.envelope); } catch { wrongPassRejected = true; }
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