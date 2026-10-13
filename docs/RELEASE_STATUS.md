# Release status

## Synthetic prototype

This repository currently delivers a **Synthetic prototype**, not an approved production integration. The portable TypeScript core, CLI, thin VS Code extension shell, deterministic fixture demo, repository-safety scan, and synthetic encrypted-backup drill can be built and verified on macOS arm64 and Windows x64.

No release artifact or fixture contains work content, credentials, local databases, private notes, raw prompts, logs, or exports. Build output is local and ignored by Git. Source fixtures are explicitly named `*.synthetic.json` and use reserved example domains.

## Capability status

| Capability | Release status | Evidence / gate |
|---|---|---|
| Local fixture CLI and deterministic attention | SYNTHETIC GO | `npm run demo`; no network route |
| OS-appropriate per-user app-data paths | SYNTHETIC GO | `settings.test.ts`; `node packages/cli/dist/main.js paths` |
| Core/unit build on target architectures | SYNTHETIC GO | CI jobs `macOS-arm64` and `Windows-x64` |
| Public-repository secret/PII/work-content controls | SYNTHETIC GO | `.gitignore`; `npm run scan:repo`; history scan CI job |
| Encrypted-backup mechanics | SYNTHETIC DRILL ONLY | `npm run backup:drill`; ephemeral synthetic JSON, AES-256-GCM |
| SQLite production backup/key management | UNVERIFIED / NO-GO | G-SEC-02 and G-DB-01 remain open; no approved OS-keychain envelope |
| Direct MCP Locker | UNVERIFIED / NO-GO | G-MCP-01; no approved transport/schema/credential evidence |
| Claude-mediated MCP runner | UNVERIFIED / NO-GO | conditional discovery design only; no approved work-environment evidence |
| Approved work-model route (Claude/LiteLLM/Ollama) | UNVERIFIED / NO-GO | G-MODEL-01; synthetic/fake adapters are not approval evidence |
| Real work or personnel data | NO-GO | security/data-class approval has not been recorded |
| Signed/marketplace VS Code package or native installer | NOT PROVIDED | extension smoke is source-based in an Extension Development Host |

Open gates are authoritative in `docs/architecture/GATES.md` and `docs/SECURITY_CONNECTOR_DISCOVERY.md`. A green CI run proves only the synthetic prototype and repository controls. It must not be represented as a real MCP/model integration or as approval to process work data.

## Release commands

From a clean checkout with Node.js 22 and npm:

```text
npm ci
npm run release:check
```

That command builds, type-checks, runs unit tests and the deterministic demo, checks repository contents and release documentation, scans tracked files, and performs an ephemeral encrypted-backup round trip. Run the full-history public-repository scan separately before publishing:

```text
node scripts/scan-repo-safety.mjs --history
```

See `docs/SYNTHETIC_RUNBOOK.md` for the executable fresh-install and demo checklist and `docs/ENCRYPTED_BACKUP_DRILL.md` for backup limitations.
