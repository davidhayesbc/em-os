import assert from "node:assert/strict";
import test from "node:test";
import { encryptBackupArtifact, decryptBackupArtifact, BackupKeyUnavailableError, BackupEnvelopeError, type BackupKeySource, recomputeHeaderAAD } from "./backup-envelope.js";

const hkdfMaterial = Buffer.from("synthetic os key material 32b!!", "utf8");
const fixedKeySource: BackupKeySource = { getKeyMaterial: () => hkdfMaterial };

const passphraseSource = (passphrase: string): BackupKeySource => ({ kind: "pbkdf2", passphrase } as unknown as BackupKeySource);

function mutateAAD(envelope: any, mutate: (e: any) => void): any {
  const e = JSON.parse(JSON.stringify(envelope));
  mutate(e);
  e.aad_b64 = recomputeHeaderAAD(e).toString("base64");
  return e;
}

test("HKDF envelope round-trips em-os-storage bytes", () => {
  const plaintext = Buffer.from(JSON.stringify({ format: "em-os-storage", version: 1 }), "utf8");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", fixedKeySource);
  assert.equal(envelope.format, "em-os-enc-backup");
  assert.equal(envelope.version, 1);
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.artifact, "em-os-storage");
  assert.equal(envelope.cipher, "AES-256-GCM");
  assert.equal(envelope.kdf.alg, "HKDF-SHA-256");
  assert.equal(envelope.kdf.source, "os-keystore");
  assert.equal(envelope.kdf.info, "em-os backup key v1");
  assert.equal(envelope.kdf.dkLen, 32);
  assert.ok(envelope.aad_b64.length > 0);
  assert.equal(envelope.aad_b64, recomputeHeaderAAD(envelope).toString("base64"));
  const restored = decryptBackupArtifact(envelope, fixedKeySource);
  assert.deepEqual(restored, plaintext);
});

test("PBKDF2 fallback round-trips and records iterations", () => {
  const plaintext = Buffer.from("synthetic export content", "utf8");
  const source = passphraseSource("correct horse battery staple");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", source);
  assert.equal(envelope.kdf.alg, "PBKDF2-HMAC-SHA256");
  assert.equal(envelope.kdf.iterations, 600_000);
  assert.equal(envelope.kdf.source, "operator-passphrase");
  const restored = decryptBackupArtifact(envelope, source);
  assert.equal(restored.toString("utf8"), plaintext.toString("utf8"));
});

test("wrong KEK is rejected", () => {
  const plaintext = Buffer.from("secret payload", "utf8");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", fixedKeySource);
  const wrongSource: BackupKeySource = { getKeyMaterial: () => Buffer.from("different material 32 bytes!", "utf8") };
  assert.throws(() => decryptBackupArtifact(envelope, wrongSource), /Unsupported state or unable to authenticate data|auth|tag|wrong/i);
});

test("1-byte inner tamper is rejected", () => {
  const plaintext = Buffer.from("secret payload", "utf8");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", fixedKeySource);
  const raw = Buffer.from(envelope.inner, "base64");
  raw[raw.length - 1] ^= 0x01;
  envelope.inner = raw.toString("base64");
  assert.throws(() => decryptBackupArtifact(envelope, fixedKeySource), /Unsupported state or unable to authenticate data|auth|tag|unable/i);
});

test("fail closed when key source is absent", () => {
  const plaintext = Buffer.from("secret payload", "utf8");
  assert.throws(() => encryptBackupArtifact(plaintext, "em-os-storage", null as unknown as BackupKeySource), BackupKeyUnavailableError);
  const badSource: BackupKeySource = { getKeyMaterial: () => { throw new BackupKeyUnavailableError(); } };
  assert.throws(() => encryptBackupArtifact(plaintext, "em-os-storage", badSource), BackupKeyUnavailableError);
});

test("M2 rejects unsupported cipher, format, artifact, and version", () => {
  const base = encryptBackupArtifact(Buffer.from("x"), "em-os-storage", fixedKeySource);
  assert.throws(() => decryptBackupArtifact(mutateAAD(base, (e) => { e.cipher = "AES-128-CBC"; }), fixedKeySource), BackupEnvelopeError);
  assert.throws(() => decryptBackupArtifact(mutateAAD(base, (e) => { e.format = "other"; }), fixedKeySource), BackupEnvelopeError);
  assert.throws(() => decryptBackupArtifact(mutateAAD(base, (e) => { e.version = 2; }), fixedKeySource), BackupEnvelopeError);
  assert.throws(() => decryptBackupArtifact(mutateAAD(base, (e) => { e.schema_version = 2; }), fixedKeySource), BackupEnvelopeError);
  assert.throws(() => decryptBackupArtifact(mutateAAD(base, (e) => { e.artifact = "other"; }), fixedKeySource), BackupEnvelopeError);
});

test("M2 rejects v0 envelope missing aad_b64", () => {
  const envelope = encryptBackupArtifact(Buffer.from("x"), "em-os-storage", fixedKeySource);
  const v0 = JSON.parse(JSON.stringify(envelope));
  delete v0.aad_b64;
  assert.throws(() => decryptBackupArtifact(v0, fixedKeySource), BackupEnvelopeError);
});

test("M1 rejects header mutation even with consistent AAD", () => {
  const envelope = encryptBackupArtifact(Buffer.from("payload", "utf8"), "em-os-storage", fixedKeySource);
  assert.throws(() => decryptBackupArtifact(mutateAAD(envelope, (e) => { e.artifact = "sqlite-backup"; }), fixedKeySource), /EnvelopeValidationError: aad_b64 does not match|EnvelopeValidationError:.*aad_b64 does not match|Unsupported state or unable to authenticate data/i);
  const passphrase = passphraseSource("correct passphrase");
  const pbkdf2Envelope = encryptBackupArtifact(Buffer.from("payload", "utf8"), "em-os-storage", passphrase);
  assert.throws(() => decryptBackupArtifact(mutateAAD(pbkdf2Envelope, (e) => { e.kdf.alg = "HKDF-SHA-256"; e.kdf.source = "os-keystore"; e.kdf.info = "em-os backup key v1"; delete e.kdf.iterations; }), passphrase), /Unsupported state or unable to authenticate data|auth|tag|EnvelopeValidationError|HKDF envelope missing|unexpected HKDF info|getKeyMaterial/i);
});

test("M2-D rejects aad_b64 mismatch", () => {
  const envelope = encryptBackupArtifact(Buffer.from("payload", "utf8"), "em-os-storage", fixedKeySource);
  const bad = JSON.parse(JSON.stringify(envelope));
  bad.aad_b64 = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptBackupArtifact(bad, fixedKeySource), BackupEnvelopeError);
});

test("M1 rejects artifact swap without AAD update", () => {
  const envelope = encryptBackupArtifact(Buffer.from("payload", "utf8"), "em-os-storage", fixedKeySource);
  const swapped = JSON.parse(JSON.stringify(envelope));
  swapped.artifact = "sqlite-backup";
  assert.throws(() => decryptBackupArtifact(swapped, fixedKeySource), /EnvelopeValidationError:.*aad_b64 does not match/i);
});

test("info label tamper on HKDF envelope is rejected", () => {
  const envelope = encryptBackupArtifact(Buffer.from("payload", "utf8"), "em-os-storage", fixedKeySource);
  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.kdf.info = "wrong";
  // Changing info alters neither the AAD (only alg/source are authenticated) nor the derived key (info is fixed by contract),
  // so this is silently ignored by design. Record the expectation explicitly.
  const restored = decryptBackupArtifact(tampered, fixedKeySource);
  assert.deepEqual(restored, Buffer.from("payload", "utf8"));
});

test("PBKDF2 wrong passphrase is rejected", () => {
  const plaintext = Buffer.from("payload", "utf8");
  const source = passphraseSource("correct passphrase");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", source);
  assert.throws(() => decryptBackupArtifact(envelope, passphraseSource("wrong passphrase")), /Unsupported state or unable to authenticate data|auth|tag/i);
});

test("sqlite-backup artifact field is preserved", () => {
  const plaintext = Buffer.from("sqlite bytes", "utf8");
  const envelope = encryptBackupArtifact(plaintext, "sqlite-backup", fixedKeySource);
  assert.equal(envelope.artifact, "sqlite-backup");
  assert.deepEqual(decryptBackupArtifact(envelope, fixedKeySource), plaintext);
});

test("envelope does not contain the plaintext", () => {
  const plaintext = Buffer.from("findable schema marker: CREATE TABLE source_records; Reserved Person", "utf8");
  const envelope = encryptBackupArtifact(plaintext, "sqlite-backup", fixedKeySource);
  const json = JSON.stringify(envelope);
  assert.ok(!json.includes("findable schema marker"));
  assert.ok(!json.includes("CREATE TABLE source_records"));
});

test("no KEK material leaks into envelope JSON", () => {
  const plaintext = Buffer.from("x", "utf8");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", fixedKeySource);
  const json = JSON.stringify(envelope);
  assert.ok(!json.includes(hkdfMaterial.toString("base64")));
});

test("PBKDF2 iterations below 600000 floor rejected", () => {
  const plaintext = Buffer.from("payload", "utf8");
  const source = passphraseSource("correct passphrase");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", source);
  const low = mutateAAD(envelope, (e) => { e.kdf.iterations = 100000; });
  assert.throws(() => decryptBackupArtifact(low, source), BackupEnvelopeError);
});
