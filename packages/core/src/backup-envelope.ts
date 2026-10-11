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
  if (envelope.cipher !== "AES-256-GCM") errors.push(`cipher must be AES-256-GCM, got ${JSON.stringify(envelope.cipher)}`);
  if (envelope.format !== "em-os-enc-backup") errors.push(`format must be em-os-enc-backup, got ${JSON.stringify(envelope.format)}`);
  if (envelope.version !== 1 || typeof envelope.version !== "number") errors.push(`version must be integer 1, got ${JSON.stringify(envelope.version)}`);
  if (envelope.schema_version !== 1 || typeof envelope.schema_version !== "number") errors.push(`schema_version must be integer 1, got ${JSON.stringify(envelope.schema_version)}`);
  if (typeof envelope.aad_b64 !== "string" || envelope.aad_b64.length === 0) errors.push("aad_b64 must be present (v1 contract); v0 envelopes are invalid");
  if (!envelope.artifact || !["em-os-storage", "sqlite-backup"].includes(envelope.artifact)) errors.push(`unknown artifact ${JSON.stringify(envelope.artifact)}`);
  if (!envelope.kdf?.alg || !["HKDF-SHA-256", "PBKDF2-HMAC-SHA256"].includes(envelope.kdf.alg)) errors.push(`unknown kdf.alg ${JSON.stringify(envelope.kdf?.alg)}`);
  if (envelope.kdf?.alg === "PBKDF2-HMAC-SHA256" && (!Number.isInteger(envelope.kdf?.iterations) || (envelope.kdf.iterations as number) < PBKDF2_ITERS)) {
    errors.push(`PBKDF2 iterations below ${PBKDF2_ITERS} floor`);
  }
  if (typeof envelope.aad_b64 === "string" && envelope.aad_b64.length > 0) {
    const recomputed = headerAAD(envelope);
    let received: Buffer | null = null;
    try { received = Buffer.from(envelope.aad_b64, "base64"); } catch { received = null; }
    if (!received || !recomputed.equals(received)) errors.push("aad_b64 does not match recomputed header AAD (byte-exact)");
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
  const salt = Buffer.from(envelope.kdf.salt_b64, "base64");
  if (envelope.kdf.alg === "PBKDF2-HMAC-SHA256") {
    const pbkdf2 = kekSource as Partial<PBKDF2KeySource>;
    if (pbkdf2.kind !== "pbkdf2" || typeof pbkdf2.passphrase !== "string") throw new BackupKeyUnavailableError("PBKDF2 passphrase key source required");
    return Buffer.from(pbkdf2Sync(pbkdf2.passphrase, salt, envelope.kdf.iterations ?? PBKDF2_ITERS, envelope.kdf.dkLen ?? 32, "sha256"));
  }
  if (envelope.kdf.alg !== "HKDF-SHA-256") throw new BackupEnvelopeError(`unsupported kdf: ${envelope.kdf.alg}`);
  const keyMaterial = kekSource.getKeyMaterial();
  const material = Buffer.isBuffer(keyMaterial) ? keyMaterial : (() => { throw new BackupKeyUnavailableError("sync key material required"); })();
  if (!Buffer.isBuffer(material) || material.length === 0) throw new BackupKeyUnavailableError();
  return Buffer.from(hkdfSync("sha256", material, salt, HKDF_INFO, envelope.kdf.dkLen ?? 32));
}

export function decryptBackupArtifact(envelope: EncryptedBackupEnvelope, kekSource: BackupKeySource): Buffer {
  validateEnvelope(envelope); // throws BEFORE any KDF/decryption work
  const kek = deriveKekForDecrypt(envelope, kekSource);
  const decipher = createDecipheriv("aes-256-gcm", kek, Buffer.from(envelope.nonce_b64, "base64"));
  decipher.setAAD(headerAAD(envelope)); // AAD from received header, never trust producer's aad_b64
  decipher.setAuthTag(Buffer.from(envelope.tag_b64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(envelope.inner, "base64")), decipher.final()]);
}
