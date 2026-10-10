# EM OS architecture decisions

These records turn `docs/PRODUCT_SPEC.md` into implementation boundaries. They are normative for the MVP unless a later accepted ADR supersedes them.

| ADR | Status | Decision |
|---|---|---|
| [0001](0001-core-cli-extension-boundaries.md) | Accepted | Portable TypeScript core; CLI and VS Code extension are thin adapters |
| [0002](0002-runtime-and-dependency-gates.md) | Accepted with gates | Node-first baseline; Bun and dependencies require portability/security evidence |
| [0003](0003-sqlite-fts-storage.md) | Accepted with driver gate | SQLite + FTS5 outside checkout; native driver selected by matrix spike |
| [0004](0004-mcp-ingress.md) | Proposed, blocked on discovery | Direct MCP SDK if approved and supported; otherwise bounded Claude runner |
| [0005](0005-model-provider-interface.md) | Accepted interface; routes gated | Capability- and classification-aware model provider abstraction |
| [0006](0006-provenance-citations.md) | Accepted | Immutable provenance and validated citations with human approval |
| [0007](0007-local-paths-failure-offline.md) | Accepted with policy gates | OS app-data paths, fail-closed routes, isolated sync failures, honest freshness |

## Decision vocabulary

- **Accepted:** implement now.
- **Accepted with gate:** boundary is fixed, concrete package/setting waits for recorded evidence.
- **Proposed, blocked on discovery:** no production implementation may depend on an assumed answer.
- **Superseded:** retained for history and linked to its replacement.

## Cross-cutting rules

1. Public source, tests, docs, logs, and CI contain synthetic data only. Work content and credentials never enter the checkout (`PRODUCT_SPEC.md` §§2, 9, 13).
2. External source access is read-only and allowlisted; cursor advancement occurs only in the same successful transaction as persistence (`PRODUCT_SPEC.md` §§2, 6, 9).
3. Models do not rank work, execute source text, or initiate writes to corporate systems (`PRODUCT_SPEC.md` §§4, 7–9).
4. All user-visible derived claims expose provenance, freshness, and failure state (`PRODUCT_SPEC.md` §§5–7, 9).
5. Unknown policy or capability answers fail closed and remain explicit gates, not implementation guesses (`PRODUCT_SPEC.md` §§2, 12, 14).

## Implementation review checklist

Every PR that introduces a package, connector, model route, storage driver, or external process must update [the gate register](GATES.md), link the relevant ADR, and include:

- exact package and resolved version; SPDX license and source; whether transitive licenses were checked;
- registry provenance/integrity lockfile, maintainer/activity assessment, and current advisory scan output;
- supported Node/VS Code host versions and macOS arm64 + Windows x64 install/build/test evidence;
- native binary, postinstall, subprocess, network, telemetry, credential, and data-egress behavior;
- synthetic tests named by the ADR, plus rollback/fallback behavior.

## Consistency review

Run from the repository root:

```sh
node scripts/check-architecture-docs.mjs
```

The checker verifies ADR numbering, required decision sections, spec citations, index links, and that every unresolved gate has an owner/evidence/unblock condition. It reads documentation only and performs no network access.
