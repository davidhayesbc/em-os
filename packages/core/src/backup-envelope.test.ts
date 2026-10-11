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

test("HKDF info tamper is rejected before key source access", () => {
  const envelope = encryptBackupArtifact(Buffer.from("payload", "utf8"), "em-os-storage", fixedKeySource);
  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.kdf.info = "wrong";
  let calls = 0;
  const countingSource: BackupKeySource = { getKeyMaterial: () => { calls++; return hkdfMaterial; } };
  assert.throws(() => decryptBackupArtifact(tampered, countingSource), BackupEnvelopeError);
  assert.equal(calls, 0);
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

test("M2 rejects missing kdf, missing nonce_b64, missing tag_b64, and non-object envelope", () => {
  const base = encryptBackupArtifact(Buffer.from("x"), "em-os-storage", fixedKeySource);
  const missingKdf = JSON.parse(JSON.stringify(base)); delete missingKdf.kdf;
  assert.throws(() => decryptBackupArtifact(missingKdf, fixedKeySource), BackupEnvelopeError);
  const nullKdf = JSON.parse(JSON.stringify(base)); nullKdf.kdf = null;
  assert.throws(() => decryptBackupArtifact(nullKdf, fixedKeySource), BackupEnvelopeError);
  const missingNonce = JSON.parse(JSON.stringify(base)); delete missingNonce.nonce_b64;
  assert.throws(() => decryptBackupArtifact(missingNonce, fixedKeySource), BackupEnvelopeError);
  const missingTag = JSON.parse(JSON.stringify(base)); delete missingTag.tag_b64;
  assert.throws(() => decryptBackupArtifact(missingTag, fixedKeySource), BackupEnvelopeError);
  assert.throws(() => decryptBackupArtifact(null as unknown as typeof base, fixedKeySource), BackupEnvelopeError);
});

test("PBKDF2 iterations below 600000 floor rejected", () => {
  const plaintext = Buffer.from("payload", "utf8");
  const source = passphraseSource("correct passphrase");
  const envelope = encryptBackupArtifact(plaintext, "em-os-storage", source);
  const low = mutateAAD(envelope, (e) => { e.kdf.iterations = 100000; });
  assert.throws(() => decryptBackupArtifact(low, source), BackupEnvelopeError);
});

test("M2 validates every encoded field and exact HKDF contract before KDF", () => {
  const base = encryptBackupArtifact(Buffer.from("payload"), "em-os-storage", fixedKeySource);
  const mutations: Array<[string, (envelope: any) => void]> = [
    ["missing inner", (e) => { delete e.inner; }],
    ["non-string inner", (e) => { e.inner = null; }],
    ["invalid inner base64", (e) => { e.inner = "***not-base64***"; }],
    ["invalid nonce base64", (e) => { e.nonce_b64 = "***not-base64***"; }],
    ["short nonce", (e) => { e.nonce_b64 = Buffer.alloc(11).toString("base64"); }],
    ["invalid tag base64", (e) => { e.tag_b64 = "A==="; }],
    ["short tag", (e) => { e.tag_b64 = Buffer.alloc(15).toString("base64"); }],
    ["missing salt", (e) => { delete e.kdf.salt_b64; }],
    ["invalid salt base64", (e) => { e.kdf.salt_b64 = "***not-base64***"; }],
    ["short salt", (e) => { e.kdf.salt_b64 = Buffer.alloc(15).toString("base64"); }],
    ["wrong dkLen", (e) => { e.kdf.dkLen = 16; }],
    ["wrong source", (e) => { e.kdf.source = "operator-passphrase"; }],
    ["wrong info", (e) => { e.kdf.info = "wrong"; }],
    ["missing info", (e) => { delete e.kdf.info; }],
    ["unknown envelope field", (e) => { e.extra = true; }],
    ["mistyped created_at", (e) => { e.created_at = 42; }],
    ["unknown kdf field", (e) => { e.kdf.extra = true; }],
  ];
  for (const [name, mutate] of mutations) {
    const malformed = JSON.parse(JSON.stringify(base)); mutate(malformed);
    if (malformed.kdf?.source) malformed.aad_b64 = recomputeHeaderAAD(malformed).toString("base64");
    let calls = 0;
    const countingSource: BackupKeySource = { getKeyMaterial: () => { calls++; return hkdfMaterial; } };
    assert.throws(() => decryptBackupArtifact(malformed, countingSource), BackupEnvelopeError, name);
    assert.equal(calls, 0, `${name} must fail before getKeyMaterial`);
  }
});

test("PBKDF2 exact v1 contract rejects wrong source, dkLen, fields, and oversized work before KDF", () => {
  const source = passphraseSource("correct passphrase");
  const base = encryptBackupArtifact(Buffer.from("payload"), "em-os-storage", source);
  for (const [name, mutate] of [
    ["oversized iterations", (e: any) => { e.kdf.iterations = 600_001; }],
    ["non-integer iterations", (e: any) => { e.kdf.iterations = 600_000.5; }],
    ["wrong source", (e: any) => { e.kdf.source = "os-keystore"; }],
    ["wrong dkLen", (e: any) => { e.kdf.dkLen = 16; }],
    ["unexpected info", (e: any) => { e.kdf.info = "em-os backup key v1"; }],
  ] as Array<[string, (e: any) => void]>) {
    const malformed = mutateAAD(base, mutate);
    assert.throws(() => decryptBackupArtifact(malformed, source), BackupEnvelopeError, name);
  }
});
