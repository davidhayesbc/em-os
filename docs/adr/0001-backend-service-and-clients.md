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
