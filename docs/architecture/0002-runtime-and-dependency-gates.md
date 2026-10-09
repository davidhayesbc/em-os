# ADR 0002: Runtime and dependency acceptance gates

- Status: Accepted with gates
- Date: 2026-10-09
- Spec: `docs/PRODUCT_SPEC.md` §§2, 6, 9–10, 14

## Context

Yarvis uses Bun and several useful packages, but parity is not evidence that they work in the VS Code extension host, on Windows x64, or under company policy. Native SQLite is the largest packaging risk. The public repository must not acquire unlicensed source, unsafe install scripts, telemetry, or unapproved egress.

## Decision

Use current supported Node.js LTS semantics as the MVP runtime baseline and npm-compatible lockfiles. Compile extension output for the Node version supported by the declared minimum VS Code release. Bun may be used only after gate `G-RT-01`; it must not become required merely for tests or scripts before that gate passes.

No dependency is accepted from an ADR name alone. The introducing PR must record in a dependency ledger:

1. package, exact resolved version, registry/source and integrity lock;
2. SPDX license and transitive-license scan; never copy Yarvis source unless its license permission is independently established;
3. current vulnerability/advisory scan and triage, package provenance, maintenance activity;
4. lifecycle/postinstall scripts, downloaded binaries, network/telemetry, subprocess and credential behavior;
5. Node ABI/ESM/CJS and VS Code extension-host compatibility;
6. clean install/build/test on macOS arm64 and Windows x64, including offline behavior after dependencies are cached;
7. data classes and destinations if the package can cause egress.

Candidate posture from `PRODUCT_SPEC.md` §14:

- Zod: preferred trust-boundary validator, pending ledger check.
- Biome and TypeScript: preferred development tools, pending ledger check.
- YAML: add only with trusted prompt/skill files and unknown-key rejection.
- MCP SDK: choose at most one after ADR 0004 discovery.
- Vercel AI SDK: optional only if it reduces verified provider complexity; no unused public-provider adapters.
- Drizzle: optional; adopt only if migrations/types justify its driver and bundle cost.
- React/Vite/Playwright, schedulers, vector engines, Tauri, Hono: deferred until a scoped need exists.

Lockfiles are committed; automated advisory output is CI evidence, not an automatic substitute for review. A critical/high exploitable advisory, unknown/disallowed license, unexpected egress, or unsupported target platform blocks merge.

## Bun-versus-Node criteria

Gate `G-RT-01` requires identical build/unit/CLI behavior, VS Code extension-host compatibility, child-process behavior, lockfile reproducibility, native-module compatibility, debugging/support maturity, policy approval, and measured material benefit on both target OS/architectures. Otherwise Node remains the runtime; Bun can remain an optional local tool only if outputs are identical.

## Alternatives considered

- Bun-first for Yarvis consistency: rejected pending evidence.
- Dual first-class runtimes: rejected because it doubles matrix and lockfile/runtime drift.
- No third-party packages: rejected where maintained parsers/protocol clients reduce security risk.
- Automatic upgrades without review: rejected because runtime/native/data-egress changes require gate evidence.

## Consequences

The baseline favors extension compatibility and organizational familiarity over speculative speed. Package adoption is slower but auditable. CI must have target-OS jobs and preserve scan artifacts without work data.

## Test implications

- CI installs from lockfile, typechecks, builds, runs units, and packages the extension on Windows x64 and macOS arm64.
- A clean-environment smoke checks no undeclared postinstall network requirement.
- License and advisory checks fail with a reviewed allowlist/exception mechanism.
- Runtime tests exercise cancellation, paths, Unicode, long paths, process exit codes, and ESM/CJS boundaries.
