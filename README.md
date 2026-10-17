# EM OS for VS Code

EM OS is a local-first engineering-manager workbench prototype. Its VS Code extension presents an accessible Attention Queue with explicit freshness, provenance, and source information, plus commands for reviewing synthetic action items, capturing proposed evidence, and creating a clearly marked offline weekly-update draft.

The current `0.1.0` extension is intentionally synthetic and offline: Sync loads bundled synthetic data, no production connector or model route is configured, and no credentials should be entered into its settings. Queue state is stored in VS Code extension global state.

## Installation

### Prerequisites

- [Visual Studio Code](https://code.visualstudio.com/) 1.105.0 or later
- For building from source: Node.js 22 or later and npm

### Install a released VSIX

1. Download `em-os-vscode.vsix` from the desired version on the repository's [Releases page](https://github.com/davidhayesbc/em-os/releases).
2. In VS Code, open **Extensions**.
3. Open the Extensions view's **...** menu and select **Install from VSIX...**.
4. Select the downloaded file and reload VS Code if prompted.

The same file can be installed from a terminal when the `code` command is available:

```sh
code --install-extension /path/to/em-os-vscode.vsix
```

### Build and install from source

From the repository root:

```sh
npm ci --ignore-scripts
npm run package:vsix
code --install-extension artifacts/em-os-vscode.vsix
```

`npm run package:vsix` compiles all workspaces and packages the extension with the pinned `@vscode/vsce` version. The output is `artifacts/em-os-vscode.vsix`.

For development without installing a VSIX, run `npm ci`, open the repository in VS Code, and use **Run Extension** (or press `F5`) to start an Extension Development Host.

## Configuration

Open VS Code **Settings** and search for `EM OS`, or add settings to `settings.json`.

| Setting | Type | Default | Constraints | Description |
| --- | --- | --- | --- | --- |
| `em-os.workspacePath` | string | `""` | None | Optional local Foam workspace path. Do not put credentials in this value. The current synthetic prototype declares the setting for future local-workspace integration but does not yet read or write the path. |
| `em-os.staleCiHours` | number | `24` | Minimum `1` | Age in hours before failing CI becomes an attention candidate. The current extension uses a bundled synthetic queue and does not yet apply this setting during Sync. |

Example workspace settings:

```json
{
  "em-os.workspacePath": "/Users/example/Documents/foam",
  "em-os.staleCiHours": 12
}
```

On Windows, JSON paths require escaped backslashes:

```json
{
  "em-os.workspacePath": "C:\\Users\\example\\Documents\\foam"
}
```

These are the only extension settings currently contributed. They are not credential fields. Production data sources, model providers, and credential storage remain unconfigured and fail closed.

## Usage

The extension activates when the **EM OS** Attention Queue view is opened.

1. Select the **EM OS** checklist icon in the Activity Bar, or run **EM OS: Open Inbox** from the Command Palette.
2. Run **EM OS: Sync** from the Command Palette or use the Sync button in the Attention Queue title bar. In this version, Sync refreshes synthetic offline data and reports that no connector is configured.
3. Inspect the status rows for snapshot freshness, sync state, and source permissions. Each action item shows freshness and workflow status; its tooltip also includes rationale, provenance, observation time, and source.
4. Select an item to open its synthetic source URL, or use its context-menu actions:
   - **EM OS: Confirm Action** changes a proposed item to confirmed.
   - **EM OS: Complete Action** marks an item completed and removes it from the visible queue.
   - **EM OS: Snooze Action** hides an item until tomorrow or next week.

Queue changes persist in VS Code's extension global state.

### Commands

All commands are available from the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS).

| Command | What it does |
| --- | --- |
| **EM OS: Sync** | Replaces/merges the queue with the bundled synthetic offline snapshot. It makes no network request. |
| **EM OS: Open Inbox** | Opens and focuses the Attention Queue. |
| **EM OS: What Next** | Shows visible queue items in a picker and opens the selected synthetic source URL. |
| **EM OS: Open Source** | Opens a selected item's validated source URL in the default browser. |
| **EM OS: Confirm Action** | Moves a proposed item to confirmed status. |
| **EM OS: Complete Action** | Marks an item completed. |
| **EM OS: Snooze Action** | Snoozes an item for 24 or 168 hours. |
| **EM OS: Capture Evidence** | Prompts for a local/synthetic observation and opens an unsaved Markdown document marked `proposed`; it does not save or approve evidence automatically. |
| **EM OS: Draft Weekly Update** | Opens an unsaved Markdown draft that explicitly states no approved facts are available; it makes no model request. |

## Troubleshooting

### The extension does not appear

Confirm that your VS Code version satisfies `^1.105.0`. In the Extensions view, verify that **EM OS** (`em-os.em-os-vscode`) is installed and enabled, then reload the window and open the EM OS Activity Bar view.

### Sync says it failed or is offline

This is expected in version `0.1.0`. The extension has no production connector and uses synthetic local data only. A warning is displayed so synthetic data cannot be mistaken for current work data.

### A completed or snoozed item disappeared

Completed items are excluded from the visible queue. Snoozed items return after their snooze time expires. Reinstalling the extension does not necessarily clear VS Code global state.

### Verify a locally built package

On Linux with Xvfb installed, run the packaged Extension Host smoke test:

```sh
npm ci --ignore-scripts
npm run package:vsix
xvfb-run -a npm run test:vsix-smoke
```

See [`docs/BUILDING.md`](docs/BUILDING.md) for the complete build, test, data-path, and release-check documentation.
