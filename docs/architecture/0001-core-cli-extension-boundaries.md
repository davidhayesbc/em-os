# ADR 0001: Core, CLI, and VS Code extension boundaries

- Status: Accepted
- Date: 2026-10-09
- Spec: `docs/PRODUCT_SPEC.md` §§2, 5–7, 9, 14

## Context

The product needs a preferred VS Code surface without making sync, ranking, storage, or drafting depend on an open editor or webview. MCP and model access remain discovery-gated. The same behavior must run on macOS arm64 and Windows x64.

## Decision

Use a dependency-inverted TypeScript architecture with these packages:

- `core`: entities, use cases, deterministic rules, validation contracts, and ports. It imports no VS Code API, SQLite driver, MCP SDK, model SDK, filesystem path convention, or process-global singleton.
- `storage-sqlite`: implements repository, transaction, migration, FTS, retention, and provenance ports.
- `connectors`: one adapter per source. Adapters return validated page/delta DTOs and never write storage directly; a core sync use case owns persistence and post-commit cursor advancement.
- `model-providers`: implements the ADR 0005 interface. Tool access is separate from text generation.
- `cli`: composition root for sync/query/draft/health commands. It emits stable exit codes and human or JSON output and is the headless/manual-sync path.
- `vscode-extension`: composition root and thin presentation adapter. Commands and tree items call core use cases; no core job requires an active webview. Secrets use approved VS Code/OS facilities through a port, never extension settings.

Ports carry plain, schema-validated DTOs. Core APIs accept an explicit clock, filesystem/app-data locator, logger, transaction boundary, and cancellation signal. No package reaches across another adapter to use its internals. Markdown drafts are outputs; arbitrary Foam text is not promoted to a trusted record.

Initial deployment is in-process. Do not add a loopback HTTP sidecar until multi-process ownership is required and authenticated transport is designed.

## Alternatives considered

- Put all behavior in the extension: rejected because closed-IDE/offline/headless operation and testability would fail.
- Build a Tauri/desktop shell or Hono sidecar: deferred as an MVP non-goal and unnecessary attack/packaging surface.
- Let connectors persist directly: rejected because transaction, provenance, deletion, and cursor invariants would fragment.
- Reuse Yarvis source/framework wholesale: rejected; its architecture is reference-only and its reviewed checkout lacked a license file (`PRODUCT_SPEC.md` §14).

## Consequences

Positive: deterministic core tests need no VS Code/network; CLI remains a fallback; connector/model/storage packages can change behind ports. Negative: more interfaces and composition code; extension and CLI must each wire dependencies and surface the same health/freshness semantics.

## Test implications

- Contract tests run each adapter against shared synthetic DTO fixtures.
- Core tests use fake clock/storage/connectors/models and prove no network dependency.
- CLI smoke proves a synthetic PR sync and deterministic query while offline.
- Extension smoke proves commands work without a webview and source links/failure/freshness are exposed.
- An import-boundary test rejects `vscode`, database drivers, MCP/model SDKs, and Node process/filesystem access from core domain modules.
