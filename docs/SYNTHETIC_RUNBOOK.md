# Synthetic demo and fresh-install runbook

This runbook is safe for a public checkout. It uses only checked-in synthetic fixtures and creates no network connection. Do not substitute work exports, notes, credentials, or real source URLs.

## Prerequisites

- A fresh clone of this repository.
- Node.js 22 LTS with the bundled npm.
- macOS arm64 or Windows x64. Linux is useful for development but is not a release target in the MVP specification.
- VS Code 1.105 or later only for the optional extension smoke.

## 1. Fresh install and automated release check

Open a terminal at the repository root and run exactly:

```text
npm ci
npm run release:check
```

Expected final evidence includes:

```text
encrypted backup drill: PASS
release manifest check: PASS
repository safety scan: PASS
```

The command also runs TypeScript checks, all unit tests, and the pinned-clock synthetic CLI demo. Any non-zero exit is a failed checklist; do not publish.

For the full-history scan used by the public-repository CI gate, run:

```text
node scripts/scan-repo-safety.mjs --history
```

## 2. Verify local data paths

After the build, run:

```text
node packages/cli/dist/main.js paths
```

Confirm the displayed directory is outside the Git checkout and follows the host convention:

- macOS: `~/Library/Application Support/em-os/`
- Windows: `%APPDATA%\em-os\`

For an isolated synthetic check, set `EM_OS_DATA_DIR` to a disposable directory before running `paths`. Do not put a real data directory beneath this repository. Settings may contain paths and thresholds only; credentials belong in an approved OS credential store once that gate is closed.

## 3. Deterministic CLI demo

Run:

```text
npm run demo
```

Verify the output identifies synthetic attention items, includes human-readable reasons and freshness, and prints only reserved `.invalid` links. Repeat the command and confirm output is stable because the demo clock is pinned. The command reads `fixtures/prs.synthetic.json`; it does not fetch those links.

## 4. VS Code extension source smoke

1. Complete `npm ci && npm run build`.
2. Open `packages/vscode-extension` in VS Code.
3. Press F5 and choose the Extension Development Host if prompted.
4. In the new host, open the Command Palette.
5. Confirm these commands are discoverable: `EM OS: Sync`, `EM OS: Open Inbox`, `EM OS: What Next`, `EM OS: Draft Weekly Update`, and `EM OS: Capture Evidence`.
6. Invoke each command and verify it either shows synthetic/local output or an explicit not-configured/fail-closed message.
7. Confirm no credential prompt, network sign-in, real workspace scan, or webview opens.

This is an unpackaged source smoke, not evidence of a signed extension or approved MCP access.

## 5. Synthetic encrypted-backup drill

Run:

```text
npm run backup:drill
```

The drill creates a temporary synthetic export, encrypts it, proves a plaintext marker is absent, rejects an incorrect key, restores byte-identical content, and deletes the temporary directory. Details and production limitations are in `docs/ENCRYPTED_BACKUP_DRILL.md`.

## 6. Release decision

Read `docs/RELEASE_STATUS.md`. A passing checklist authorizes only the synthetic prototype. Direct MCP Locker, a Claude-mediated runner, approved work-model routes, production SQLite encryption/key management, real work data, and signed installers remain unavailable unless their named gates have approved work-environment evidence.
