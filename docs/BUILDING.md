# Build and synthetic demo

EM OS currently ships as a synthetic-only TypeScript prototype. It makes no network requests and does not contain an MCP or model credential path.

## Supported build strategy

Node.js 22 LTS and npm are the portable runtime/toolchain. TypeScript compiles the core, CLI, and thin VS Code extension shell to CommonJS. The GitHub Actions matrix executes install, typecheck, unit tests, and the deterministic demo on `macos-14` arm64 and `windows-latest` x64. There is no native SQLite dependency in this scaffold; the storage driver remains an explicit downstream gate. This keeps the first build portable while retaining a `Storage` interface and an OS app-data database path.

## Fresh install

```text
npm ci
npm run build
npm test
npm run demo
```

`npm run demo` pins its clock so output is repeatable. For an ordinary current-time run:

```text
node packages/cli/dist/main.js attention --fixture fixtures/prs.synthetic.json
```

The CLI reads only the named local JSON fixture. Source links use the reserved `.invalid` domain and are printed, not fetched.

## Local settings and data paths

Run `node packages/cli/dist/main.js paths` to inspect resolved paths. Defaults follow the host convention:

- macOS: `~/Library/Application Support/em-os/`
- Windows: `%APPDATA%\\em-os\\`
- Linux/development: `$XDG_DATA_HOME/em-os/` or `~/.local/share/em-os/`

`settings.json` and the future `em-os.sqlite3` live there, never in a checkout. `EM_OS_DATA_DIR` may override the directory for a test or controlled installation. Settings contain paths and thresholds only; credentials belong in an approved OS credential store.

## VS Code extension smoke

1. Run `npm ci && npm run build`.
2. Open `packages/vscode-extension` in VS Code and launch an Extension Development Host.
3. In the Command Palette verify `EM OS: Sync`, `EM OS: Open Inbox`, `EM OS: What Next`, `EM OS: Draft Weekly Update`, and `EM OS: Capture Evidence` are present.
4. Invoke each command. The scaffold reports that the capability is synthetic/local or not configured; it does not require or open a webview and performs no network access.

The storage-driver, MCP, real-data, credential-storage, encryption, and approved model routes remain fail-closed gates documented in `docs/architecture/GATES.md` and `docs/SECURITY_CONNECTOR_DISCOVERY.md`.
