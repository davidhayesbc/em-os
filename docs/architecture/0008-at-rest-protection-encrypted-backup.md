# ADR 0008: At-rest protection and encrypted backup envelope

- Status: Accepted with policy conditions (closes gate `G-SEC-02` subject to §Policy conditions)
- Date: 2026-10-10
- Spec: `docs/PRODUCT_SPEC.md` §§2, 6, 9, 12, 13
- Related: `docs/architecture/GATES.md` (G-SEC-02), `docs/architecture/0003-sqlite-fts-storage.md`, `docs/architecture/0007-local-paths-failure-offline.md`, `docs/SECURITY_REVIEW.md` (SEC-04)

## Context

`docs/SECURITY_REVIEW.md` finding SEC-04 (Medium) records that backups and exports are unencrypted: `packages/core/src/storage.ts` `backupTo()` produces a plaintext `sqlite` backup copy, `writeExport()` writes plaintext JSON (mode `0o600`, which is weak on Windows), and the SQLite database is opened without application-level encryption. Gate `G-SEC-02` (at-rest and backup protection: threat model; FileVault/BitLocker state; DB-encryption decision; encrypted backup destination and restore drill) is open, and the DoD (§13) requires restoring "the local data from an encrypted backup".

The review's scope note applies: the MVP is a synthetic prototype with no real work data, credential path or approved ingestion route. The gate therefore has to be decided so that the synthetic prototype and future implementations share one enforceable envelope, and so the release label cannot overstate recovery-readiness.

## Decision

1. **Layering.** OS full-disk encryption (FileVault on the work Mac, BitLocker on Windows x64) is the **baseline at-rest control for the DB**, and is mandatory before any non-synthetic data is stored. **Application-level DB encryption is not required in the MVP**: single-user, per-user-ACL app-data storage under the ADR 0007 path roots, with a bounded local threat model. The decision is conditional — §Policy conditions defines when SQLCipher-style application-level DB encryption becomes required.

2. **Backup/exports are application-encrypted regardless of disk encryption.** Everything that copies data off the DB path or between devices — `backupTo()`, `writeExport()`, and any `backupToInsecure()`-equivalent plaintext path, which is **reserved for development, must be explicitly named as insecure, and must never be the default** — is wrapped in an AES-256-GCM key-envelope format, `em-os-enc-backup` version 1 (see §Envelope format). The DB itself stays plain SQLite; this decision is about backups/exports and the layering policy.

3. **Envelope format, `em-os-enc-backup` v1 — outer JSON, inner payload unchanged.** The inner format remains the existing `em-os-storage` JSON export (version, checksummed, importable). The outer envelope is:

   ```json
   {
     "format": "em-os-enc-backup",
     "version": 1,
     "inner": "<base64 ciphertext of em-os-storage JSON>",
     "nonce_b64": "<base64 96-bit AES-GCM nonce>",
     "kdf": { "alg": "PBKDF2-HMAC-SHA256", "iterations": 600000, "salt_b64": "<base64 128-bit salt>", "dkLen": 32 },
     "cipher": "AES-256-GCM",
     "tag_b64": "<base64 128-bit GCM tag>",
     "created_at": "<ISO-8601 UTC>",
     "schema_version": "<inner em-os-storage version at creation>"
   }
   ```

   The data-encryption key (DEK, 256-bit) is uniformly random, generated per backup, and never written to disk. The key-encryption key (KEK) is **derived from the OS key material that backs the OS credential store — Keychain on macOS, DPAPI-protected storage on Windows — never from an application-config file**, using HKDF with the fixed `info` label `"em-os backup key v1"`; PBKDF2 with a 600000-iteration cost is the fallback for environments where that OS material is unreachable, and PBKDF2 salt or key material is never stored inside the backup file. If the KEK source is unavailable, the operation **fails closed** and produces no ciphertext. Every restore verifies the GCM tag before any plaintext exists outside memory.

4. **Restore drill.** Closing G-SEC-02 requires a scripted, repeatable **synthetic** drill: create a synthetic populated DB → `backupTo()` → verify the file on disk carries no readable schema markers or strings → restore into a fresh DB → assert the record set is complete, hashes match, GCM tamper-rejection fails the restore (corrupt-1-byte test), and deletion tombstones round-trip. The drill is automated and recorded as gate evidence; it never operates on real work data.

5. **Release labeling.** Until gate `G-SEC-02` reaches **Passed** in `docs/architecture/GATES.md`, any unencrypted-backup build or release artifact is labeled a **synthetic prototype**, not a verified recovery-ready release. The recovery claim in §13 ("restore the local data from an encrypted backup") is **unverified** for such builds; passing G-SEC-02 is what makes the recovery claim verifiable. The label applies specifically to backup/recovery readiness; it does not retroactively change the other synthetic-only verification scopes defined by §13 and the gate register `Unblocks` column.

## Envelope format rationale

- AES-256-GCM gives authenticated encryption: a corrupted or substituted backup file fails restore instead of importing hostile content (supporting the SEC-03 hardening of `importData`).
- Binding to OS key material, never a config file, prevents "encrypted" backups whose key sits in the same directory; PBKDF2 cost 600000 follows OWASP 2023+ guidance for password-derived storage keys where an OS keystore is unavailable.
- The envelope wraps the existing export verbatim, so the storage module's export/import/test surface, including `importData` column-allowlist hardening, is reused unchanged.

## Policy conditions (must hold while G-SEC-02 is Passed)

- **Threat model currency:** the approved threat model (`docs/SECURITY_REVIEW.md` §1 scope plus corporate policy) stays current; material changes return the gate to Open along with G-PATH-01. Corporate policy or owner decisions must not contradict this record; contradictions reopen the gate before storage.
- **Approved destinations:** OS-keychain-derived-key envelope backups land only at the ADR 0007 `backups/` root (OS app-data), never in the Git checkout, never in the public repo; **the corporate-managed/network backup agent (Windows endpoint backup, macOS iCloud/Time Machine) remains unapproved for backups containing em-os data until the G-PATH-01 destination policy names it**; exports stay out of sync/cloud tools per ADR 0007 until an employer-approved encrypted sync path is recorded.
- **Windows work-data eligibility:** G-PATH-01 determines whether work data may reside on the personal Windows device at all; if it does not, the Windows instance remains synthetic-only and this gate's Windows evidence is moot. If it does, §Policy conditions item 7 requires application-level verification on Windows.
- **Sensitive data classes:** personnel/HR-class records get stricter retention and export handling than work-product records, per §9. The envelope applies to all classes; policy adds class-specific constraints on top.

## Gate rule application

Per the gate procedure: the gate state may move to **Passed** only when this decision holds **and** §Policy conditions hold **and** the drill evidence (item 4) exists; per the release rule, any capability named in `Unblocks` — storing sensitive data and declaring recovery ready — stays blocked while the gate is Open. This record does not approve any real ingestion route; G-MCP-01/G-SEC-01/G-MODEL-01 remain Open.

## Alternatives considered

- **No application-level envelope; rely on FileVault/BitLocker alone:** rejected — disks protect data at rest, not files that move between devices, not copies made by cloud/backup agents, and not restores onto machines without policy-verified disk encryption.
- **SQLCipher application-level DB encryption now:** rejected for the MVP — real work data cannot be stored until G-MCP-01/G-SEC-01/G-PATH-01 pass anyway; it adds native packaging risk while G-DB-01 (driver selection, including encryption compatibility) is open. Revisit via the §Policy conditions.
- **Passphrase-only envelope without OS keystore binding (PBKDF2 as primary):** rejected — passphrase strength and rotation cannot be verified by this repo; the OS-derived KEK is the primary key source, PBKDF2 is the documented fallback.
- **Plaintext backups plus restrictive file permissions (status quo):** rejected — `0o600` is not an access-control boundary on Windows, and any copy leaves the DB path unencrypted.
- **Envelope with config-file KEK:** rejected — "encrypted with a key stored next to the data" provides no additional protection beyond mode bits.
- **No backups at all until gates pass:** rejected — the DoD requires a verifiable restore path and the envelope is implementable with synthetic data safely; blocking the drill would hide an unproven recovery path instead.

## Consequences

Implementers must add the envelope around `backupTo()`/`writeExport()` (coder; already scheduled as the SEC-04 code follow-up) and keep plaintext paths dev-only and named. Users must accept that backups cannot be opened without the OS-keystore-derived key and that a destroyed OS profile makes backups unrecoverable unless paired with the PBKDF2 fallback under policy. CI cannot verify encryption of local artifacts; the drill evidence, not CI, carries the gate. The synthetic-prototype label is retained until the gate passes, so no release may claim recovery readiness.

## Test implications

- Envelope unit tests on synthetic data: round-trip, wrong-key rejection, tamper (1-byte flip) rejection, nonce uniqueness, fail-closed KEK-unavailable, no plaintext-schema strings on disk, and deterministic manifest fields (`format`, `version`, `kdf`, `cipher`, `schema_version`).
- Drill script (`scripts/backup-restore-drill.mjs`): populated-to-restore record equality, FTS and deletion-state equivalence, and pass/fail exit code suitable for CI and gate evidence capture.
- Migration/backup tests already required by ADR 0003/0007 gain the envelope contract; restore refuses unencrypted exports when the envelope is enabled.