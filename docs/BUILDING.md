# Build and synthetic demo

EM OS currently ships as a synthetic-only TypeScript prototype. It makes no network requests and does not contain an MCP or model credential path.

## Supported build strategy

Node.js 22 LTS and npm are the portable runtime/toolchain. TypeScript compiles the core, CLI, and thin VS Code extension shell to CommonJS. The GitHub Actions matrix executes install, typecheck, unit tests, architecture documentation validation, security discovery fixture validation, and the deterministic demo on `macos-14` arm64 and `windows-latest` x64. There is no native SQLite dependency in this scaffold; the storage driver remains an explicit downstream gate. This keeps the first build portable while retaining a `Storage` interface and an OS app-data database path.

## Fresh install

```text
npm ci
npm run build
npm test
npm run demo
```

`npm run ci` runs typecheck, the architecture/security validators, tests, and the demo. `npm run demo` pins its clock so output is repeatable. For an ordinary current-time run:

```text
node packages/cli/dist/main.js attention --fixture fixtures/prs.synthetic.json
```

The CLI reads only the named local JSON fixture. Source links use the reserved `.invalid` domain and are printed, not fetched.

## Local settings and data paths

Run `node packages/cli/dist/main.js paths` to inspect resolved paths. Defaults follow the host convention and ADR 0007:

- macOS: `~/Library/Application Support/EM OS/`
- Windows: `%LOCALAPPDATA%\EM OS\` (or `%APPDATA%\EM OS\` via a documented override)
- Linux/development: `$XDG_DATA_HOME/em-os/` or `~/.local/share/em-os/`

Subdirectories separate `db/`, `backups/`, `cache/`, and redacted operational `logs/`. `settings.json` and `db/em-os.sqlite3` live there, never in a checkout. `EM_OS_DATA_DIR` may override the directory for a test or controlled installation. Settings contain paths and thresholds only; credentials belong in an approved OS credential store.

## Backup and restore

`packages/core` provides three storage-level operations:

- `writeExport(path)` / `restoreFromExport(dbPath, exportPath)` — versioned **plaintext** JSON export/import for portability tests. This is not encrypted and must not be labeled encrypted.
- `backupTo(path)` / `restoreFromRawSQLite(path)` — raw SQLite file copy. This is not encrypted; it relies on OS-level disk encryption (FileVault/BitLocker) and approved backup destination encryption.
- `writeEncryptedBackup(path, key)` / `restoreFromEncryptedBackup(backupPath, key, dbPath)` — **authenticated encrypted backup** using AES-256-GCM with a random IV and caller-supplied key. The envelope carries a manifest (`format`, `version`, `exportedAt`, `schemaVersion`, and a SHA-256 integrity digest) and rejects wrong keys, malformed envelopes, and tampered ciphertext. The key is never persisted or logged.

The MVP definition of done requires restore from an encrypted backup. The current implementation satisfies that contract synthetically; application-level DB encryption and production key management remain gated by `G-SEC-02`.

## VS Code extension smoke

1. Run `npm ci && npm run build`.
2. Open `packages/vscode-extension` in VS Code and launch an Extension Development Host.
3. In the Command Palette verify `EM OS: Sync`, `EM OS: Open Inbox`, `EM OS: What Next`, `EM OS: Draft Weekly Update`, and `EM OS: Capture Evidence` are present.
4. Invoke each command. The scaffold reports that the capability is synthetic/local or not configured; it does not require or open a webview and performs no network access.

The storage-driver, MCP, real-data, credential-storage, encryption, and approved model routes remain fail-closed gates documented in `docs/architecture/GATES.md` and `docs/SECURITY_CONNECTOR_DISCOVERY.md`.
