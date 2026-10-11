import { createCipheriv, createDecipheriv, hkdfSync, pbkdf2Sync, randomBytes } from "node:crypto";

export type BackupArtifact = "em-os-storage" | "sqlite-backup";

export interface BackupKeySource {
  /** Return OS-keystore-backed key material, or undefined/throw if unavailable. */
  getKeyMaterial(): Promise<Buffer> | Buffer;
}

export interface EncryptedBackupEnvelope {
  format: "em-os-enc-backup";
  version: 1;
  artifact: BackupArtifact;
  inner: string; // base64 ciphertext
  nonce_b64: string; // base64 12-byte AES-GCM nonce
  kdf: {
    alg: "HKDF-SHA-256" | "PBKDF2-HMAC-SHA256";
    source: "os-keystore" | "operator-passphrase";
    info?: string;
    salt_b64: string;
    dkLen: 32;
    iterations?: number;
  };
  cipher: "AES-256-GCM";
  tag_b64: string; // base64 16-byte GCM tag
  aad_b64: string; // base64 canonical header AAD
  created_at: string;
  schema_version: 1;
}

export interface PBKDF2KeySource extends BackupKeySource {
  kind: "pbkdf2";
  passphrase: string;
}

export class BackupKeyUnavailableError extends Error {
  constructor(message = "backup key source unavailable") { super(message); this.name = "BackupKeyUnavailableError"; }
}

export class BackupEnvelopeError extends Error {
  constructor(message: string) { super(message); this.name = "BackupEnvelopeError"; }
}

const HKDF_INFO = "em-os backup key v1";
const PBKDF2_ITERS = 600_000;
// Version 1 deliberately fixes the work factor. This is both the minimum and
// maximum accepted value so an untrusted envelope cannot choose KDF cost.
const PBKDF2_MAX_ITERS = PBKDF2_ITERS;

const ENVELOPE_FIELDS = ["aad_b64", "artifact", "cipher", "created_at", "format", "inner", "kdf", "nonce_b64", "schema_version", "tag_b64", "version"];
const HKDF_FIELDS = ["alg", "dkLen", "info", "salt_b64", "source"];
const PBKDF2_FIELDS = ["alg", "dkLen", "iterations", "salt_b64", "source"];

function hasExactlyFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function decodeCanonicalBase64(value: unknown, field: string, expectedLength?: number): { decoded?: Buffer; error?: string } {
  if (typeof value !== "string") return { error: `${field} must be a base64 string` };
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return { error: `${field} must be canonical base64` };
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) return { error: `${field} must be canonical base64` };
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    return { error: `${field} must decode to exactly ${expectedLength} bytes` };
  }
  return { decoded };
}

// Minimal JCS-style canonical JSON: sorted object keys recursively, no insignificant whitespace.
function canonJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

function headerAAD(envelope: EncryptedBackupEnvelope): Buffer {
  const subset = {
    format: envelope.format,
    version: envelope.version,
    artifact: envelope.artifact,
    schema_version: envelope.schema_version,
    cipher: envelope.cipher,
    kdf: { alg: envelope.kdf.alg, source: envelope.kdf.source },
  };
  return Buffer.from(canonJson(subset), "utf8");
}

export function recomputeHeaderAAD(envelope: EncryptedBackupEnvelope): Buffer { return headerAAD(envelope); }

function validateEnvelope(envelope: EncryptedBackupEnvelope): void {
  const errors: string[] = [];
  if (typeof envelope !== "object" || envelope === null) throw new BackupEnvelopeError("EnvelopeValidationError: envelope must be an object");
  const envelopeRecord = envelope as unknown as Record<string, unknown>;
  if (!hasExactlyFields(envelopeRecord, ENVELOPE_FIELDS)) errors.push("envelope contains missing or unknown fields");
  if (envelope.cipher !== "AES-256-GCM") errors.push(`cipher must be AES-256-GCM, got ${JSON.stringify(envelope.cipher)}`);
  if (envelope.format !== "em-os-enc-backup") errors.push(`format must be em-os-enc-backup, got ${JSON.stringify(envelope.format)}`);
  if (envelope.version !== 1 || typeof envelope.version !== "number") errors.push(`version must be integer 1, got ${JSON.stringify(envelope.version)}`);
  if (envelope.schema_version !== 1 || typeof envelope.schema_version !== "number") errors.push(`schema_version must be integer 1, got ${JSON.stringify(envelope.schema_version)}`);
  if (typeof envelope.created_at !== "string") errors.push("created_at must be a string");
  if (typeof envelope.aad_b64 !== "string" || envelope.aad_b64.length === 0) errors.push("aad_b64 must be present (v1 contract); v0 envelopes are invalid");
  if (!envelope.artifact || !["em-os-storage", "sqlite-backup"].includes(envelope.artifact)) errors.push(`unknown artifact ${JSON.stringify(envelope.artifact)}`);
  const inner = decodeCanonicalBase64(envelope.inner, "inner"); if (inner.error) errors.push(inner.error);
  const nonce = decodeCanonicalBase64(envelope.nonce_b64, "nonce_b64", 12); if (nonce.error) errors.push(nonce.error);
  const tag = decodeCanonicalBase64(envelope.tag_b64, "tag_b64", 16); if (tag.error) errors.push(tag.error);
  if (typeof envelope.kdf !== "object" || envelope.kdf === null) errors.push("kdf must be an object");
  else {
    const kdf = envelope.kdf as unknown as Record<string, unknown>;
    const salt = decodeCanonicalBase64(kdf.salt_b64, "kdf.salt_b64", 16); if (salt.error) errors.push(salt.error);
    if (kdf.dkLen !== 32 || !Number.isInteger(kdf.dkLen)) errors.push("kdf.dkLen must be integer 32");
    if (kdf.alg === "HKDF-SHA-256") {
      if (!hasExactlyFields(kdf, HKDF_FIELDS)) errors.push("HKDF kdf contains missing or unknown fields");
      if (kdf.source !== "os-keystore") errors.push("HKDF source must be os-keystore");
      if (kdf.info !== HKDF_INFO) errors.push(`HKDF info must be ${JSON.stringify(HKDF_INFO)}`);
    } else if (kdf.alg === "PBKDF2-HMAC-SHA256") {
      if (!hasExactlyFields(kdf, PBKDF2_FIELDS)) errors.push("PBKDF2 kdf contains missing or unknown fields");
      if (kdf.source !== "operator-passphrase") errors.push("PBKDF2 source must be operator-passphrase");
      if (!Number.isInteger(kdf.iterations) || (kdf.iterations as number) < PBKDF2_ITERS || (kdf.iterations as number) > PBKDF2_MAX_ITERS) {
        errors.push(`PBKDF2 iterations must be an integer from ${PBKDF2_ITERS} through ${PBKDF2_MAX_ITERS}`);
      }
    } else {
      errors.push(`unknown kdf.alg ${JSON.stringify(kdf.alg)}`);
    }
  }
  if (typeof envelope.aad_b64 === "string" && envelope.aad_b64.length > 0 && typeof envelope.kdf === "object" && envelope.kdf !== null && typeof envelope.kdf.alg === "string") {
    const recomputed = headerAAD(envelope);
    const aad = decodeCanonicalBase64(envelope.aad_b64, "aad_b64");
    if (aad.error) errors.push(aad.error);
    else if (!recomputed.equals(aad.decoded!)) errors.push("aad_b64 does not match recomputed header AAD (byte-exact)");
  }
  if (errors.length) throw new BackupEnvelopeError(`EnvelopeValidationError: ${errors.join("; ")}`);
}

function deriveKek(source: BackupKeySource, salt: Buffer): { kek: Buffer; kdf: EncryptedBackupEnvelope["kdf"] } {
  const pbkdf2 = source as Partial<PBKDF2KeySource>;
  if (pbkdf2.kind === "pbkdf2" && typeof pbkdf2.passphrase === "string") {
    const kek = Buffer.from(pbkdf2Sync(pbkdf2.passphrase, salt, PBKDF2_ITERS, 32, "sha256"));
    return { kek, kdf: { alg: "PBKDF2-HMAC-SHA256", source: "operator-passphrase", salt_b64: salt.toString("base64"), dkLen: 32, iterations: PBKDF2_ITERS } };
  }
  const keyMaterial = source.getKeyMaterial();
  const material = Buffer.isBuffer(keyMaterial) ? keyMaterial : (() => {
    const maybePromise = keyMaterial as Promise<Buffer>;
    if (typeof maybePromise.then !== "function") throw new BackupKeyUnavailableError();
    throw new BackupKeyUnavailableError("sync key material required; async key sources are not supported in this build");
  })();
  if (!Buffer.isBuffer(material) || material.length === 0) throw new BackupKeyUnavailableError();
  const kek = Buffer.from(hkdfSync("sha256", material, salt, HKDF_INFO, 32));
  return { kek, kdf: { alg: "HKDF-SHA-256", source: "os-keystore", info: HKDF_INFO, salt_b64: salt.toString("base64"), dkLen: 32 } };
}

export function encryptBackupArtifact(plaintext: Buffer, artifact: BackupArtifact, kekSource: BackupKeySource): EncryptedBackupEnvelope {
  if (!kekSource) throw new BackupKeyUnavailableError();
  const salt = randomBytes(16);
  const { kek, kdf } = deriveKek(kekSource, salt);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek, nonce);
  const aad = headerAAD({ format: "em-os-enc-backup", version: 1, artifact, schema_version: 1, cipher: "AES-256-GCM", kdf, inner: "", nonce_b64: nonce.toString("base64"), tag_b64: "", aad_b64: "", created_at: "", });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: "em-os-enc-backup",
    version: 1,
    artifact,
    inner: ciphertext.toString("base64"),
    nonce_b64: nonce.toString("base64"),
    kdf,
    cipher: "AES-256-GCM",
    tag_b64: cipher.getAuthTag().toString("base64"),
    aad_b64: aad.toString("base64"),
    created_at: new Date().toISOString(),
    schema_version: 1,
  };
}

function deriveKekForDecrypt(envelope: EncryptedBackupEnvelope, kekSource: BackupKeySource): Buffer {
  const salt = Buffer.from(envelope.kdf?.salt_b64 ?? "", "base64");
  if (envelope.kdf?.alg === "PBKDF2-HMAC-SHA256") {
    const pbkdf2 = kekSource as Partial<PBKDF2KeySource>;
    if (pbkdf2.kind !== "pbkdf2" || typeof pbkdf2.passphrase !== "string") throw new BackupKeyUnavailableError("PBKDF2 passphrase key source required");
    return Buffer.from(pbkdf2Sync(pbkdf2.passphrase, salt, envelope.kdf.iterations ?? PBKDF2_ITERS, envelope.kdf.dkLen ?? 32, "sha256"));
  }
  if (envelope.kdf?.alg !== "HKDF-SHA-256") throw new BackupEnvelopeError(`unsupported kdf: ${envelope.kdf?.alg}`);
  const keyMaterial = kekSource.getKeyMaterial();
  const material = Buffer.isBuffer(keyMaterial) ? keyMaterial : (() => { throw new BackupKeyUnavailableError("sync key material required"); })();
  if (!Buffer.isBuffer(material) || material.length === 0) throw new BackupKeyUnavailableError();
  return Buffer.from(hkdfSync("sha256", material, salt, HKDF_INFO, envelope.kdf.dkLen ?? 32));
}

export function decryptBackupArtifact(envelope: EncryptedBackupEnvelope, kekSource: BackupKeySource, expectedArtifact?: BackupArtifact): Buffer {
  validateEnvelope(envelope); // throws BEFORE any KDF/decryption work
  if (expectedArtifact !== undefined && envelope.artifact !== expectedArtifact) {
    throw new BackupEnvelopeError(`expected ${expectedArtifact} artifact, got ${envelope.artifact}`);
  }
  const kek = deriveKekForDecrypt(envelope, kekSource);
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(envelope.nonce_b64, "base64"));
  decipher.setAAD(headerAAD(envelope)); // AAD from received header, never trust producer's aad_b64
  decipher.setAuthTag(Buffer.from(envelope.tag_b64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.inner, "base64")), decipher.final()]);
}
