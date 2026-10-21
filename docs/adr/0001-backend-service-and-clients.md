# ADR 0001: A backend service with separate clients

- **Status:** Accepted
- **Date:** 2026-10-19
- **Spec:** §§5, 6, 10

## Context

The user works mostly in VS Code and wants the first UI there. They also want the UI separated from the backend, so the system can run in different hosting environments and be reached by other clients: Claude Code via MCP, a CLI, and perhaps a web UI or other editors later.

Sync, extraction and embedding are long-running and should continue when VS Code is closed. Secrets must be usable without an editor present.

## Decision

- **`emosd`, the EM OS service:** a Node process that owns the store, scheduler, connectors, pipelines, model router, retrieval, drafting, importers and secrets (in the OS keychain). It has no editor or UI imports.
- **`core`:** pure TypeScript domain logic used by the service. It talks only to ports (`Store`, `Connector`, `LlmProvider`, `EmbeddingProvider`, `Clock`, `Logger`, `SecretStore`). A lint rule forbids I/O libraries inside `core`.
- **`api-contract`:** a versioned schema package (Zod schemas, with a generated typed client) defining every client operation and the event stream (sync progress, triage count, item changes). Clients depend only on this package.
- **Transport:**
  - loopback HTTP + JSON for requests;
  - SSE or WebSocket for events (the builder picks one);
  - a bearer token generated per install for first-party clients (extension, CLI), stored in the OS keychain and exposed to local clients through a token file readable only by the user;
  - separate per-client tokens with their own policy for MCP clients (ADR 0013).
- **Clients:**
  - the VS Code extension (ADR 0010);
  - the `emos` CLI (`import`, `doctor`, `backup`, `service install|start|stop`);
  - the EM OS MCP server (ADR 0013), which runs inside the service, with a stdio launcher (`emos mcp`) for MCP clients that need stdio.
- **Hosting modes:**
  1. **Managed** (default): the extension starts the service if it isn't running and attaches to it.
  2. **Standalone:** `emos service install` registers a per-user OS background service (launchd / Task Scheduler / systemd).
  3. **Remote:** possible by design, because the API never assumes a shared filesystem between client and service, but not supported until TLS, authentication and the privacy model are revisited (ADR 0012).
- **Single writer:** only the service writes to the store. A lock file prevents two services running against the same data directory.

**Phase 0 spike, service runtime.** The candidates are:

- a Node runtime bundled with the extension or CLI;
- VS Code's own Electron binary run as Node (`ELECTRON_RUN_AS_NODE`);
- ~~requiring a system Node 22+~~ — ruled out by the distribution requirement below.

Choose based on install friction, the native-module ABI (ADR 0002), standalone mode working without VS Code, and package size. Record the result here.

**Distribution:** published to the VS Code Marketplace and Open VSX, which also handle auto-update, with the same VSIX on GitHub Releases. The VSIX bundles the service and the CLI. A hard requirement: users never install Node.js separately. If native modules are needed, publish platform-specific VSIXs (`vsce package --target darwin-arm64|win32-x64`). Standalone mode uses the runtime chosen by the spike.

## Alternatives considered

- **Everything inside the VS Code extension host:** rejected. The UI is coupled to the backend, sync stops when VS Code is closed, and other clients can't attach.
- **A standalone desktop app:** rejected as the primary UI, because the user wants to stay in VS Code. The service architecture keeps this possible later as just another client.
- **A cloud backend:** rejected. It conflicts with local-first, and it's a non-goal.

## Consequences

- **Benefits:**
  - any client can be added without touching the backend;
  - sync runs headless in standalone mode;
  - Claude Code gets the same data through MCP.
- **Costs:**
  - a process lifecycle to manage: start, attach, upgrade, crash restart;
  - an API contract to version;
  - loopback authentication.
- **Upgrade rule:** clients and the service negotiate the API version on connect. An incompatible client shows "update EM OS" rather than failing obscurely.

## Spike result (2026-10-19)

**Decisions:**

- **`RUNTIME`: `bundled-node`.** Ship the official Node.js 24 LTS binary (tested 24.22.0) inside a platform-specific VSIX (`vsce package --target darwin-arm64` and `--target win32-x64`). The extension, the `emos` CLI and standalone mode all run the service with that binary.
- **`KEYCHAIN_LIB`: `@napi-rs/keyring`** (tested 2.1.1). It is an N-API addon, so it is not tied to a Node ABI. It has no install scripts and ships per-platform prebuilt packages, including `win32-x64-msvc` (Windows Credential Manager) and `darwin-arm64` (macOS Keychain).

The SQLite driver is recorded in ADR 0002 (`node:sqlite`).

**Evidence, macOS arm64** (the machine had VS Code 1.142.0, Electron 43.7.7, embedded Node 24.21.0, `process.versions.modules` 148):

| Runtime candidate | Binary | `node:sqlite` (FTS5, WAL, `backup()`) | Third-party native addon (`better-sqlite3`, `@napi-rs/keyring`) | Keychain set/get/delete `em-os-spike` |
|---|---|---|---|---|
| `bundled-node` | official Node 24.22.0 (`modules` 137) | pass | pass | pass |
| `electron-as-node` | `Code.app/Contents/MacOS/Code` | pass | **fail**: `dlopen` refused, "different Team IDs" (hardened runtime without `disable-library-validation`) | **fail** (same cause) |
| `electron-as-node` | `Code Helper (Plugin)` (this is `process.execPath` inside the extension host) | pass | pass (this helper has `disable-library-validation`) | pass |

- **Standalone simulation:** both passing binaries also passed under `env -i HOME=…`, which approximates launchd's empty environment. They ran as independent processes. A full test with VS Code quit is not recorded, because VS Code was in use on the test machine.
- **Install:** none of the candidate packages has a `preinstall`, `install` or `postinstall` script. Everything ships pre-built inside the VSIX, so installing it needs no network and no postinstall step. `npm` runs only on the build machine.
- **The keychain test secret** was deleted after each run. `security find-generic-password -s em-os-spike` confirmed nothing was left behind.

**Comparison:**

| Criterion | `bundled-node` | `electron-as-node` |
|---|---|---|
| Users install Node? | No | No |
| VSIX size impact | About +39 MB on darwin-arm64 and about +35 MB on win32-x64 (`zip -9` of a 122.5 MB / 93.9 MB binary) | about 0 |
| Platform-specific VSIX | Required (one Node binary per target, plus the keyring addon) | Also required in practice: the runtime needs none, but the `@napi-rs/keyring` native addon is per-target either way |
| Network or postinstall at user install | None | None |
| Standalone with VS Code closed | Yes. No dependency on VS Code at all. | Yes, but only while VS Code stays installed at a known path. It breaks if VS Code is moved or uninstalled. |
| Node version | Pinned by us | Changes whenever VS Code updates Electron, and differs in forks and Insiders. Open VSX users mostly run forks, whose Electron may predate `node:sqlite`. |
| macOS native addons | Work (the official binary allows them) | Work only through the `Code Helper (Plugin)` path, not the main `Code` binary |
| Windows updates | Independent of VS Code | Risk (inferred, not tested): a long-running `Code.exe` service may hold the file lock the VS Code updater needs |

**Why `bundled-node`:**

- It is the simplest option operationally: one pinned runtime for managed mode, standalone mode and the CLI, so there is one Node version to test.
- It doesn't depend on which editor is installed or where.
- The costs are about 35–39 MB per VSIX and building one VSIX per platform. ADR 0001 already accepts platform-specific VSIXs.

**Packaging the runtime (for P0-15):**

- **Pin the exact version.** Pin one Node version (for example `24.22.0`) in a single checked-in place that the packaging script reads. Dev and CI use the same major (`.nvmrc`, `engines.node >=24`, CI `node-version: 24`). Bump the pin deliberately for security releases.
- **Download per target at package time.** Fetch the official archive for each target from the Node.js release distribution (`node-v<ver>-darwin-arm64.tar.xz` and `node-v<ver>-win-x64.zip`), and extract only `bin/node` or `node.exe`. Never commit the binaries.
- **Verify before use.** Check each archive against `SHASUMS256.txt` for the same version, and fail packaging on any mismatch. The spike checked both 24.22.0 archives this way, and both returned `OK`. Also verify the signature on `SHASUMS256.txt.asc` against the Node.js release keys when `gpg` is available on the build runner. Pin the key fingerprints in the repo rather than fetching them at build time.
- **Never modify or re-sign the binary.** Ship it byte-for-byte as published. The official macOS binary's signature and `disable-library-validation` entitlement are what let N-API addons load, and the Windows binary keeps its publisher signature. Do not `strip`, patch, UPX-compress or re-sign it.
- **Fetch the per-target keychain addon at the same pinned version.** `@napi-rs/keyring` resolves its binary through per-platform optional dependencies, so a host install only fetches the host's binary. To package another target, install into a throwaway staging directory with an explicit platform, for example `npm install --no-save --os=win32 --cpu=x64 @napi-rs/keyring@<pinned>`. In the spike, that fetched only `@napi-rs/keyring-win32-x64-msvc` on a macOS host. Alternatively, download that one package tarball at the same pinned version (and integrity hash from the lockfile). Then copy only that target's `.node` file into that target's VSIX.
- **Keep each VSIX to one platform.** Each VSIX contains exactly one Node binary and one keyring binary, matching its `--target`. Packaging should assert this.

**Residual risks:**

- **Extension install paths are versioned.** The extension directory (`…/extensions/<id>-<version>-<target>/`) changes on every update, and the old one is deleted. `emos service install` must copy the runtime and service bundle to a stable per-user location, or re-register after each update (P0-13).
- **Executable bit.** Confirm that the bundled `node` keeps its executable bit after VSIX install. If it doesn't, `chmod` it on activation (P0-13).
- **Keychain access control.** macOS keychain items are bound to the signing identity of the binary that creates them. Any other official Node binary can read them without a prompt. This is acceptable under the "same local user" threat model (ADR 0012). Switching runtimes later would trigger a keychain prompt.
- **Cross-target packaging.** Building the `win32-x64` VSIX on another OS must fetch `@napi-rs/keyring-win32-x64-msvc` and `node.exe` explicitly. That network access happens at build time only.
- **Node maintenance.** Node 24 LTS needs security-patch bumps until its end of life. Move to Node 26 once it becomes LTS.

**Windows x64: pending the first CI run.** From published package metadata only:

- the official `node.exe` includes `node:sqlite`;
- `@napi-rs/keyring` publishes `win32-x64-msvc`, which uses Credential Manager;
- no build toolchain is needed.

**Windows verification to run:**

1. Run the spike checks under the official Node 24 LTS `node.exe`:
   - `node:sqlite` creates a DB with WAL;
   - `CREATE VIRTUAL TABLE t USING fts5(x)` succeeds;
   - 10k FTS5 inserts in one transaction take under 100 ms;
   - `backup()` to a second file succeeds, and the copy holds 10,000 rows.
2. `@napi-rs/keyring`: set, get and delete `em-os-spike`, then check with `cmdkey /list` that no entry remains.
3. Repeat step 1 with a data directory whose path has spaces and Unicode, e.g. `C:\Users\Zoë Q\AppData\Local\EM OS`.
4. Run `vsce package --target win32-x64` with `node.exe`. Install the VSIX and spawn `node.exe` from the extension directory. Check that Defender and SmartScreen don't block it, and that the process outlives VS Code.
5. Record the size of the `win32-x64` VSIX.

## Verification (2026-10-21)

CI run `39520158278` on `main` (commit `a33ff8d`) passed every job on `windows-latest` and `macos-14`.

- **Verified on Windows x64 (CI runner):**
  - `npm run package` built `em-os-win32-x64-0.0.0.vsix` on Windows: 35.4 MB, 18 files, with `node.exe` 24.22.0 and `keyring.win32-x64-msvc.node` 2.1.1. This covers checklist item 5.
  - The smoke test installed that VSIX into a clean VS Code profile. The extension spawned the bundled `node.exe`, the service wrote `service.json`, `health.get` returned API v1, and the dashboard webview loaded service data. This covers checklist item 4, apart from Defender and SmartScreen, below.
  - Unit tests passed under Node 24 on Windows, including store-sqlite (WAL, migrations, online `backup()`) and data-dir paths containing spaces and `zoë`. This covers checklist items 1 and 3, except FTS5.
- **Still pending:**
  - **Checklist item 1, FTS5:** no automated test creates an FTS5 table yet, on any OS. Tracked in P1-00.
  - **Checklist item 2, Windows Credential Manager:** `EMOS_TEST_KEYCHAIN=1` runs on macOS CI only. Tracked in P1-00.
  - **Checklist item 4, Defender, SmartScreen and outliving VS Code on a real Windows desktop:** CI runners don't exercise these. This is an owner check on a real machine.
