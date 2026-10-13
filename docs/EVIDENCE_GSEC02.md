# G-SEC-02 encrypted backup/restore drill evidence

This document archives the synthetic drill that backs gate `G-SEC-02` in `docs/architecture/GATES.md`.
All fixtures are synthetic (`reserved.test` / `example.invalid`); no network connection or real credentials are used.

## Scope and links

- **ADR 0008 decision:** `docs/architecture/0008-at-rest-protection-encrypted-backup.md`
- **Implementation PR (envelope + negatives):** https://github.com/davidhayesbc/em-os/pull/17 (branch `security/t_69f62f22-sec04-impl`)
- **CI / evidence packaging PR (this repair):** https://github.com/davidhayesbc/em-os/pull/18 (branch `feat/t_9b100434-backup-drill-ci`)
- **ADR ratification PR:** https://github.com/davidhayesbc/em-os/pull/18
- **Gate register row:** `docs/architecture/GATES.md` — `G-SEC-02 At-rest and backup protection`
- **Drill script:** `scripts/backup-restore-drill.mjs`
- **CI job:** `.github/workflows/ci.yml` — `backup-drill` matrix on macOS arm64 and Windows x64

## What the drill exercises

The drill runs against the real `packages/core/dist/storage.js` APIs (not a stub) and proves:

1. `SqliteStorage.backupToEncrypted()` — SQLite backup copy → AES-256-GCM `em-os-enc-backup` envelope → restore into a fresh DB.
2. `SqliteStorage.writeExport()` / `restoreFromExport()` — `em-os-storage` JSON export → AES-256-GCM envelope → restore.
3. On-disk plaintext controls — no `CREATE TABLE`, `source_records`, or fixture names appear in the ciphertext file.
4. Fail-closed tamper / wrong-key / absent-key rejection.
5. The ADR 0008 §Decision item 4 mandatory negative checks, each rejected with a typed pre-KDF validation error or GCM failure (never a valid-tag decrypt):
   - bogus cipher `AES-128-CBC`
   - wrong format `em-os-enc`
   - wrong `version` / `schema_version`
   - unknown `artifact`
   - missing `aad_b64` (v0 envelope)
   - `aad_b64` mismatch (M2-D)
   - `artifact` swap without AAD update (M1)
6. PBKDF2-HMAC-SHA256 operator-passphrase fallback round-trip and wrong-passphrase rejection.
7. On-disk access evidence: POSIX runners require and measure mode `0o600`; Windows runners verify current-user read/write access and explicitly do not interpret emulated POSIX mode bits as an ACL measurement. Windows destination eligibility and per-user ACL policy remain governed by ADR 0008 and G-PATH-01.

## Captured drill output

Run locally with Node 22+ after `npm ci && npm run build`:

```text
PASS  synthetic source DB populated — {"people":2,"records":25}
PASS  (A) envelope file permissions — mode 100600
PASS  (A) envelope schema fields deterministic
PASS  (A) no plaintext schema/markers on disk
PASS  (A) restored DB opens and counts match source — {"people":2,"records":25}
PASS  (A) restored PRAGMA integrity_check ok — ok
PASS  (A) restored record content equals source
PASS  (A) restored DB file permissions — mode 100600
PASS  (B) envelope file permissions — mode 100600
PASS  (B) aad_b64 equals recomputed canonical header AAD
PASS  (B) restored DB counts match source — {"people":2,"records":25}
PASS  (B) restored DB file permissions — mode 100600
PASS  tampered ciphertext rejected (GCM tag)
PASS  wrong OS keystore secret rejected
PASS  fail-closed when OS key material absent
PASS  M2 rejects bogus cipher — BackupEnvelopeError: EnvelopeValidationError: cipher must be AES-256-GCM, got "AES-128-CBC"
PASS  M2 rejects wrong format — BackupEnvelopeError: EnvelopeValidationError: format must be em-os-enc-backup, got "em-os-enc"
PASS  M2 rejects version 2 — BackupEnvelopeError: EnvelopeValidationError: version must be integer 1, got 2
PASS  M2 rejects schema_version 2 — BackupEnvelopeError: EnvelopeValidationError: schema_version must be integer 1, got 2
PASS  M2 rejects unknown artifact — BackupEnvelopeError: EnvelopeValidationError: unknown artifact "unknown-artifact"
PASS  M2 rejects v0 envelope missing aad_b64 — BackupEnvelopeError: EnvelopeValidationError: aad_b64 must be present (v1 contract); v0 envelopes are invalid
PASS  M2-D rejects aad_b64 mismatch — BackupEnvelopeError: EnvelopeValidationError: aad_b64 does not match recomputed header AAD (byte-exact)
PASS  M1 rejects artifact swap without AAD update — BackupEnvelopeError: EnvelopeValidationError: aad_b64 does not match recomputed header AAD (byte-exact)
PASS  (F) fallback envelope recorded with PBKDF2 + iterations
PASS  (F) fallback envelope round-trip restores tables
PASS  (F) restored DB file permissions — mode 100600
PASS  (F) wrong passphrase rejected

drill summary: 27/27 checks passed
encrypted backup/restore drill: PASS (synthetic fixtures only)
```

> Local temporary paths (e.g. `<temp-dir>/em-os-drill-XXXXXX`) have been redacted to `<temp-dir>`.

## CI evidence

The `backup-drill` job in `.github/workflows/ci.yml` runs `npm run backup:drill` on both matrix targets:

- `macos-14` (arm64)
- `windows-latest` (x64)

The job fails if any drill check fails, so a green CI run is continuous evidence that the G-SEC-02 envelope contract still holds. Recorded run URLs are attached as a Kanban comment / handoff.

## Gate state reference

`docs/architecture/GATES.md` lists `G-SEC-02` as `Passed` (conditional). The evidence column references this document, ADR 0008, and the CI drill. The negative checks were delivered by coder task `t_9b100434` via PR #17 (implementation) and PR #18 (CI drill wiring / this evidence doc).
