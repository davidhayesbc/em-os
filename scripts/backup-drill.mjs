import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAGIC = Buffer.from("EMOSBKP1", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encrypt(plaintext, passphrase) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(envelope, passphrase) {
  if (envelope.length < MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES || !envelope.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("invalid EM OS encrypted-backup envelope");
  }
  let offset = MAGIC.length;
  const salt = envelope.subarray(offset, offset += SALT_BYTES);
  const iv = envelope.subarray(offset, offset += IV_BYTES);
  const tag = envelope.subarray(offset, offset += TAG_BYTES);
  const ciphertext = envelope.subarray(offset);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

const directory = await mkdtemp(join(tmpdir(), "em-os-backup-drill-"));
try {
  const source = join(directory, "synthetic-export.json");
  const backup = join(directory, "synthetic-export.emos-backup");
  const restored = join(directory, "restored-synthetic-export.json");
  const passphrase = randomBytes(32).toString("base64url");
  const marker = "SYNTHETIC-BACKUP-RECORD-7d0c";
  const payload = Buffer.from(`${JSON.stringify({ format: "em-os-storage", synthetic: true, records: [{ id: marker }] })}\n`);

  await writeFile(source, payload, { mode: 0o600 });
  await writeFile(backup, encrypt(payload, passphrase), { mode: 0o600 });
  const encrypted = await readFile(backup);
  if (encrypted.includes(Buffer.from(marker))) throw new Error("plaintext marker leaked into encrypted envelope");

  let wrongKeyRejected = false;
  try { decrypt(encrypted, `${passphrase}-wrong`); } catch { wrongKeyRejected = true; }
  if (!wrongKeyRejected) throw new Error("backup accepted an incorrect passphrase");

  await writeFile(restored, decrypt(encrypted, passphrase), { mode: 0o600 });
  const roundTrip = await readFile(restored);
  if (!roundTrip.equals(payload)) throw new Error("restored bytes differ from the synthetic export");

  console.log("encrypted backup drill: PASS (AES-256-GCM authentication, wrong-key rejection, byte-identical synthetic restore)");
} finally {
  await rm(directory, { recursive: true, force: true });
}
