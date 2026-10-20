# Developing EM OS

How to install, run, debug and test the extension locally. For what EM OS is, see [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md).

Shell snippets are for macOS/Linux (`zsh`/`bash`). On Windows PowerShell, set variables with `$env:NAME = "value"` and read the home directory from `$HOME`.

## 1. Prerequisites

- **Node 24** (`.nvmrc` says `24`; root `package.json` requires `>=24`). `nvm use` / `fnm use` picks it up. The service needs it for `node:sqlite`.
- **npm** (the one bundled with Node 24).
- **VS Code 1.95 or newer** (`engines.vscode` in `packages/extension/package.json` is `^1.95.0`).
- **Platforms:** macOS arm64 is the primary target and the only one tested by hand. Windows x64 is built and tested in CI; local Windows notes are in [Troubleshooting](#7-troubleshooting).
- **Optional:** [Ollama](https://ollama.com), for the local-model features planned in later phases. Nothing in the current code needs it.

`.npmrc` sets `omit-lockfile-registry-resolved=true`. npm resolves packages through *your* configured registry, and `package-lock.json` keeps only integrity hashes, not registry URLs. Don't commit registry URLs into the lockfile.

## 2. First setup

```bash
git clone <this repo> && cd em-os
nvm use            # or any way to get Node 24
npm ci             # exact install from package-lock.json
npm run ci         # the same gate CI runs
```

`npm run ci` runs, in order:

1. `npm run lint`: Biome (`biome check .`)
2. `npm run check:fixtures`: repo-safety scan of checked-in fixtures and inline test data in `*.test.ts(x)` (the repo is public, so fixtures must be synthetic)
3. `npm run build`: every workspace package in dependency order (`scripts/workspaces.mjs`)
4. `npm run check:bundles`: the webview bundles contain no `eval`/`Function` and no remote URLs; prints their sizes
5. `npm run typecheck`: `tsc --noEmit` per package, plus `test/smoke`
6. `npm run test`: Vitest across all packages

Note `npm ci` (install) and `npm run ci` (the gate) are different commands.

## 3. Run and debug in the Extension Development Host

### Start it

1. Open the repo folder in VS Code.
2. Run and Debug, pick **EM OS extension (dev host)**, press **F5**.

The launch config (`.vscode/launch.json`):

- runs the `preLaunchTask` `npm: build` (`.vscode/tasks.json`), which is `npm run build` for all packages, so the host always starts from fresh `dist/` output;
- opens a new window with `--disable-extensions` and `--extensionDevelopmentPath=packages/extension`;
- sets `EMOS_DATA_DIR=~/.emos-dev-data` and `EMOS_SECRET_STORE=memory`.

In the dev host, resources come from the workspace packages, not a VSIX: the webview from `@emos/webview`'s `dist/`, the service from `@emos/service`'s `dist/main.js`.

### The two dev-only environment variables

- **`EMOS_DATA_DIR`** overrides the data directory on every platform. The service refuses a directory inside a git working tree, so keep it outside any checkout (`~/.emos-dev-data` is fine unless your home directory is itself a git repo).
- **`EMOS_SECRET_STORE=memory`** swaps the OS keychain for an in-process secret store. It is test/dev only and is honoured *only* when `EMOS_DATA_DIR` is also set, is the data dir the service actually runs on (compared by real path), and is not the platform default data dir; otherwise the service logs a warning and uses the keychain. `health.get` reports the store in use (`secretStore: "keychain" | "memory"`), and a Production-mode extension shows a one-time warning when it is `memory`. The API token is then regenerated on every service start, which is fine for a throwaway data dir.

Together they mean the dev host never touches your real data or your keychain.

### Use it

- Command Palette: **EM OS: Open Dashboard** opens the dashboard tab.
- The **EM OS** activity-bar icon opens the sidebar (Overview).
- **EM OS: Reconnect** re-runs "find or start the service" and reopens the event stream. The dashboard's "Service unavailable" panel has a **Retry** button that runs the same command.

The extension starts (or attaches to) the service as soon as it activates.

### Which Node starts the service

The launcher picks the Node binary in this order:

1. `EMOS_NODE_PATH`, if set (it must exist, or you get an error naming the path);
2. the bundled `<extension>/dist/runtime/node` (`node.exe` on Windows), present only in a packaged VSIX;
3. `node` on `PATH`, only in Development/Test mode (the dev host). A Production install never does this.

The Node must be 24 or newer. A VS Code launched from the Dock or Start menu often doesn't inherit your nvm `PATH`, so with nvm either start VS Code from a shell where `nvm use` ran, or point at the binary explicitly:

```bash
export EMOS_NODE_PATH="$(nvm which 24)"
code .
```

(Quit VS Code fully first; `code` only passes your environment to a fresh instance.) The launcher never uses VS Code's own Electron binary as Node, because native addons fail macOS library validation there.

### Breakpoints

- **Extension code** (`packages/extension/src`): set breakpoints in the `.ts` files and press F5. `build.mjs` emits sourcemaps and the launch config maps `packages/extension/dist/**/*.js`. After a change, stop and press F5 again (or Developer: Reload Window in the dev host after running `npm run build`).
- **Webview code** (`packages/webview/src`): in the dev host run **Developer: Open Webview Developer Tools** while the dashboard or sidebar is focused. For readable stacks and sourcemaps rebuild the webview unminified:

  ```bash
  NODE_ENV=development npm run build -w @emos/webview
  ```

  then reload the dev host. (F5 runs a normal, minified build and overwrites this.)

### Debug the service

The extension starts the service **detached**, with its working directory set to the data dir and its stdout/stderr appended to `<dataDir>/logs/service.log` (one line per event; ids and counts only; rotated to `service.log.1` past 5 MiB). You can read that log, but you can't attach a debugger to the detached process. To debug the service, run it yourself in the foreground with the same environment, then let the extension attach:

1. Stop any running dev service (it holds a lock and the extension would just attach to it):

   ```bash
   EMOS_DATA_DIR=~/.emos-dev-data EMOS_SECRET_STORE=memory node packages/cli/dist/main.js service stop
   ```

2. Start it under the inspector:

   ```bash
   EMOS_DATA_DIR=~/.emos-dev-data EMOS_SECRET_STORE=memory \
     node --inspect packages/service/dist/main.js --data-dir ~/.emos-dev-data
   ```

   Log lines print in this terminal. Attach VS Code with **Debug: Attach to Node Process** (or use a JavaScript Debug Terminal and drop `--inspect`). Breakpoints in `packages/service/src/*.ts` work through the sourcemaps.
3. Press F5 (or run **EM OS: Reconnect** in an already-running dev host). The launcher finds the live service through `run/service.json` and attaches instead of spawning a second one.

The same applies after you change service code: the service outlives the extension host, so Reconnect re-attaches to the *old* process. Run `service stop` first, then Reconnect.

## 4. Running the service and CLI by hand

The `emos` bin is not on your `PATH`. After `npm run build`, run it with either:

```bash
node packages/cli/dist/main.js <command>
npx emos <command>            # workspace bin in node_modules/.bin
```

Commands (`emos --help` lists them; no arguments or `--help` prints usage and exits 2):

| Command | What it does |
|---|---|
| `emos service start [--data-dir <path>] [--port <n>]` | Starts the service detached and waits up to 10 s until it answers. Prints `started on port N` or `already running on port N`. |
| `emos service stop [--data-dir <path>]` | SIGTERMs the service (Windows: `process.kill`) and waits for its lock to clear. Prints `stopped` or `not running`. |
| `emos service status [--data-dir <path>]` | `running on port N (pid P, version V)`, `stopped`, or `not responding` (exit 1). |
| `emos doctor [--data-dir <path>]` | Checks the data dir, not-in-git-checkout, service reachable, API version, keychain readable. Exit 1 if any check fails. |
| `emos backup <dest> [--data-dir <path>]` | Asks the running service for a consistent copy of the database at `<dest>` (a relative path is resolved against the current directory). Needs the service running. |

Always keep your dev experiments off your real data, for example:

```bash
export EMOS_DATA_DIR=~/.emos-dev-data EMOS_SECRET_STORE=memory
npx emos service start
npx emos service status
npx emos doctor
npx emos backup ~/emos-dev-backup.db
npx emos service stop
```

Caveat: `emos doctor` always reads the **real OS keychain** (item `emos/token` under service `em-os`), even with `EMOS_SECRET_STORE=memory`. It is read-only, but macOS may prompt. Expect `keychain readable` to be the only line that doesn't reflect your dev setup.

The service listens on `127.0.0.1` only. It prefers port 47821 and falls back to an ephemeral port if that is taken; the real port is in `run/service.json`.

### Data directory

Resolved in this order: `--data-dir` (CLI and `service main.js` only), then `EMOS_DATA_DIR`, then the platform default:

| OS | Default |
|---|---|
| macOS | `~/Library/Application Support/EM OS` |
| Windows | `%LOCALAPPDATA%\EM OS` |
| Linux (dev only) | `${XDG_DATA_HOME:-~/.local/share}/em-os` |

The service and `emos service start` refuse to use a directory that is inside a git checkout (any parent containing `.git`). Layout inside it:

```
<dataDir>/
  db/emos.db        SQLite database (WAL files beside it)
  backups/          pre-migration and daily backups
  config/
  logs/
  run/              runtime files, present while the service runs
    service.json    { pid, port, apiVersion, serviceVersion, startedAt }; no secrets
    token           bearer token, mode 0600
    service.lock    pid of the running instance
```

Every request except `GET /health/ping` needs `Authorization: Bearer <contents of run/token>`.

## 5. Tests

| Command | What it runs |
|---|---|
| `npm test` | All unit tests (Vitest projects: root `scripts/` plus every `packages/*`). The `vscode` module is mocked, so no Electron. |
| `npx vitest run packages/service` | One package. Works for any `packages/<name>`; add a file path or `-t "<name>"` to narrow further. |
| `npx vitest packages/cli` | The same, in watch mode. |
| `npm run lint` | Biome check of the whole repo. `npx biome check --write .` applies safe fixes. Biome does not look at `docs/`. |
| `npm run typecheck` | `tsc --noEmit` per package and for `test/smoke`. Needs a prior `npm run build` (packages resolve each other through `dist/`). |
| `npm run check:fixtures` | Fails on non-reserved email domains or URL hosts, Slack ids and tokens in checked-in fixtures (`fixtures/`, `packages/*/fixtures/`) and in `*.test.ts(x)` under `packages/` and `scripts/`. Use `example.com`/`example.org` and synthetic names only. |
| `npm run check:bundles` | After a build: fails if `packages/webview/dist/*.js` contains `new Function`, `Function(`, `eval` or an http(s) URL other than a W3C namespace, and prints each bundle's size. The webview imports runtime values only from the zod-free `@emos/api-contract/bridge` subpath (types may come from the main entry). |
| `npm run ci` | lint, fixtures, build, bundle check, typecheck, test (see section 2). |

**Real keychain test (opt-in).** `packages/service/src/server.test.ts` has one test that round-trips a secret through the real OS keychain, using service name `em-os-test` and a random key it deletes afterwards. It is skipped unless you ask for it:

```bash
EMOS_TEST_KEYCHAIN=1 npx vitest run packages/service
```

macOS may show a Keychain prompt.

**Smoke test.** `npm run smoke` runs `npm run build`, `npm run package`, then `node test/smoke/runTest.ts`. It installs this machine's VSIX into a throwaway VS Code profile, runs the suite in `test/smoke/suite/` in a real extension host, and checks the service is running on the VSIX's bundled Node.

- The first run downloads stable VS Code into `.vscode-test/` (about 300 MB, git-ignored). To use an already-installed VS Code instead, set `EMOS_SMOKE_VSCODE_PATH` to its executable.
- Packaging needs network access the first time (Node runtime from nodejs.org, keyring from your registry); it is cached under `.cache/` afterwards.
- It uses a temp `--user-data-dir`, `--extensions-dir` and `EMOS_DATA_DIR`, and the in-memory secret store, so your keychain, data dir and VS Code profile are untouched. It strips `VSCODE_*`, `ELECTRON_*` and `EMOS_*` variables from its environment first, and stops the service it started when done.
- It takes minutes and opens VS Code windows while it runs.

## 6. Packaging and installing locally

```bash
npm run build
npm run package                          # this machine: darwin-arm64 on Apple silicon
npm run package -- --target win32-x64    # cross-build the Windows VSIX
```

(`npm run package` runs `node scripts/package.mjs` in the extension package; arguments after `--` pass through. Supported targets: `darwin-arm64`, `win32-x64`.)

The script stages a single-platform extension in `packages/extension/.package/<target>/` and writes the VSIX next to the extension's `package.json`:

```
packages/extension/em-os-<target>-<version>.vsix     e.g. em-os-darwin-arm64-0.0.0.vsix   (about 40 MB)
```

It contains the extension bundle, the webview assets, the service bundle with the `@napi-rs/keyring` addon for that platform, and the official Node binary pinned in `packages/extension/node-runtime.json`. The Node archive's checksum is verified against both the pin and nodejs.org's `SHASUMS256.txt`, and any mismatch fails the build. `*.vsix`, `.package/` and `.cache/` are git-ignored.

### Install

```bash
code --install-extension packages/extension/em-os-darwin-arm64-0.0.0.vsix
```

or Extensions view, `...` menu, **Install from VSIX...**. Reload the window. The extension ID is `emos-dev.em-os`.

### Uninstall

```bash
npx emos service stop        # the service is detached and outlives VS Code
code --uninstall-extension emos-dev.em-os
```

Uninstalling removes the extension only. Your data stays in the data directory (section 4) and the API token stays in the keychain. To remove them on macOS:

```bash
rm -r "$HOME/Library/Application Support/EM OS"
security delete-generic-password -s em-os     # service name "em-os", account "emos/token"
```

### What the installed extension touches

A packaged install runs as a Production extension: it uses the **real OS keychain** and the **default data directory**, and it uses only its bundled Node (no `PATH` fallback). To keep it away from your real data, launch VS Code from a shell with `EMOS_DATA_DIR` set (fully quit VS Code first). Add `EMOS_SECRET_STORE=memory` as well if you also want to avoid the keychain; `EMOS_DATA_DIR` alone changes the data location only.

## 7. Troubleshooting

**"EM OS runtime not found: reinstall the extension or set EMOS_NODE_PATH to a Node 24 binary"**
Neither `EMOS_NODE_PATH` nor a bundled runtime exists, and the extension is not in Development mode. In an installed extension, reinstall the VSIX for your platform. In a dev host this message doesn't appear (it falls back to `node` on `PATH`); if the service then fails to start, check `node -v` in the environment VS Code was launched from.

**"EMOS_NODE_PATH points to a missing file: ..."**
Fix or unset the variable.

**"EM OS service exited (code N) before it became ready" / "did not become ready within 10s"**
The error quotes the last lines of `<dataDir>/logs/service.log`, which usually names the cause. For more, reproduce in a terminal (section 3, Debug the service). Common causes: Node older than 24, the data dir inside a git checkout (reported separately as "EM OS data directory is inside a git checkout"), or a locked keychain (not an issue with `EMOS_SECRET_STORE=memory`).

**"already running" / stale lock**
`EM OS service already running (pid N)` means another live instance holds `run/service.lock`. Find it with `npx emos service status`; stop it with `service stop`. A lock left by a crashed process (dead pid) is reclaimed automatically on the next start, and `service stop` also cleans up `service.lock` and `service.json` when the pid is gone. If something is truly stuck, check the pid with `ps -p <pid>` and only then delete `run/service.lock` and `run/service.json` by hand. `service stop` deliberately refuses to signal a pid that is alive but not answering on its port (`not responding`), because the pid may have been reused; kill that process yourself after checking what it is.

**"Service unavailable" in the dashboard or sidebar**
The extension can't reach the service or the token was rejected. Click **Retry** or run **EM OS: Reconnect**. If it persists:
1. `npx emos service status` (with the same `EMOS_DATA_DIR` the extension uses);
2. `npx emos doctor` shows which layer fails;
3. a "rejected the token" message means the service restarted with a new token (expected with the memory secret store); Reconnect re-reads `run/token`;
4. a service left over from older code: `service stop`, then Reconnect.

**Edits to service code have no effect in the dev host**
You are attached to the old, still-running service. `service stop`, rebuild, Reconnect.

**Webview shows old UI**
Rebuild with `npm run build -w @emos/webview` and reload the dev host window. F5 does a full minified build, which replaces any unminified `NODE_ENV=development` build.

**Signing and notarization**
Not applicable yet: the VSIX is unsigned and not published, and the bundled Node binary is the official one, unmodified.

**Windows**
CI builds, unit-tests and smoke-tests the `win32-x64` VSIX, but local manual testing is macOS only for now. Windows-specific local notes (paths, the Credential Manager, antivirus and the detached service) are pending CI results and will be added here.

## 8. Where things live

| Path | What |
|---|---|
| `packages/core` (`@emos/core`) | Pure domain logic and ports (clock, ids, logger, secrets, store, zoned time). No Node I/O, enforced by lint. |
| `packages/api-contract` (`@emos/api-contract`) | Zod entities, the op registry, errors and the typed client shared by every client. |
| `packages/store-sqlite` (`@emos/store-sqlite`) | SQLite store on `node:sqlite`: data-dir paths, migrations, backup. |
| `packages/service` (`@emos/service`) | The local service: loopback RPC and SSE, auth, single-instance lock, keychain secrets. Entry: `src/main.ts`. |
| `packages/cli` (`@emos/cli`) | The `emos` command (`service`, `doctor`, `backup`). A thin client of the service. |
| `packages/webview` (`@emos/webview`) | Preact dashboard and sidebar bundles, run inside VS Code webviews. |
| `packages/extension` (`em-os`) | The VS Code extension: launcher, connection, RPC bridge, panels, VSIX packaging. |
| `test/smoke/` | Extension smoke test (`npm run smoke`). |
| `scripts/` | Repo scripts: workspace build order, fixture scan, shared package build. |

Further reading:

- [`docs/PRODUCT_SPEC.md`](PRODUCT_SPEC.md): what EM OS is and why.
- [`docs/adr/`](adr/README.md): decision records. Start with [0001](adr/0001-backend-service-and-clients.md) (service, bundled Node runtime, keychain library) and [0002](adr/0002-local-sqlite-store.md) (`node:sqlite`), including their spike results.
- [`docs/plans/`](plans/README.md): phased implementation plans and the task board.
