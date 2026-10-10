# Encrypted backup drill

## Scope

`npm run backup:drill` is a dependency-free, cross-platform recovery control for the **synthetic prototype**. It exercises an authenticated AES-256-GCM envelope around a temporary synthetic JSON export. The passphrase is randomly generated in process, is never printed, and all drill files are removed in a `finally` cleanup.

The drill verifies:

1. an encrypted envelope is created with a random salt and nonce;
2. the known synthetic plaintext marker is absent from the envelope;
3. authentication rejects an incorrect passphrase;
4. restore produces byte-identical synthetic content; and
5. temporary source, encrypted, and restored files are deleted.

Run it from the repository root after installing dependencies:

```text
npm run backup:drill
```

Expected output:

```text
encrypted backup drill: PASS (AES-256-GCM authentication, wrong-key rejection, byte-identical synthetic restore)
```

## What this does not prove

This drill **does not close** G-SEC-02 or G-DB-01. It is not wired to a production SQLite database, does not select an approved OS credential/keychain provider, does not define enterprise key recovery or rotation, and has not been exercised with real work data. File mode `0600` is defense in depth and is not a portable Windows access-control guarantee.

Before processing work content, security and the product owner must approve the threat model, at-rest and backup policy, key custody/recovery, destination, retention, and a work-environment restore drill. FileVault/BitLocker or an employer-approved encrypted backup destination may be part of that decision, but their presence must be verified rather than assumed.

Never place a backup, plaintext export, passphrase, or restore output in this public repository. The `.gitignore` and repository scanner are guardrails, not substitutes for approved storage controls.
