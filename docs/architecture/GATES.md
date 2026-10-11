# Architecture gate register

This register prevents unknowns from becoming implicit defaults. Evidence must be synthetic or scrubbed; do not commit credentials, corporate endpoints, tool responses, work content, or personnel data. Source: `docs/PRODUCT_SPEC.md` §§2, 6–7, 9, 12, 14.

| Gate | State | Owner | Required evidence | Unblocks |
|---|---|---|---|---|
| G-RT-01 Bun runtime | Open; Node baseline applies | Scaffold implementer + QA | Bun/Node comparison from ADR 0002 on macOS arm64 and Windows x64, VS Code host compatibility, policy and material benefit | Making Bun a required runtime/tool |
| G-DB-01 SQLite driver | Open | Storage implementer + QA | Native and WASM candidate ledger plus full driver contract matrix from ADR 0003 | Selecting and shipping a concrete SQLite driver |
| G-MCP-01 Locker ingress | Open | Product/security discovery | Direct SDK and bounded-runner synthetic probes from ADR 0004, with exact capabilities, credential/log boundary and OS results | Selecting ingress and implementing real source access |
| G-MODEL-01 Approved model routes | Open | Product/security discovery | Per-route endpoint, auth, model, dialect, retention, classification, quality, egress and redaction evidence from ADR 0005 | Enabling a model route for each job/data class |
| G-PATH-01 Data locations | Open | Product owner + security | Approved OS app-data, Foam/export, retention, ACL/profile, Windows work-data eligibility and backup locations | Ingesting work data on each device |
| G-SEC-01 Sensitive ingestion | Open | Security | Approved classes, source/channel/repo allowlists, personnel/HR access, retention/deletion and model destinations | Any non-synthetic ingestion |
| G-SEC-02 At-rest and backup protection | Passed 2026-10-10 (approving roles: product owner + security; conditional on ADR 0008 policy conditions and G-DB-01/G-PATH-01 inputs; ADR 0008 ratified 2026-10-11 on PR #16 with required corrections M1–M3, landed in the ADR revision) | Security + IT/product owner | ADR 0008 (envelope decision + conditions, header-AAD contract, §M2 fail-closed validated field set); threat model: `docs/PRODUCT_SPEC.md` §9/§10 threat-model review surfaces + `docs/SECURITY_REVIEW.md` §3 SEC-04 record (operative threat-model evidence) and §5 approved-route scopes; FileVault/BitLocker verified on target hosts before real data (G-PATH-01); DB-encryption decision: OS full-disk baseline, application-level DB encryption conditional on ADR 0008 §Policy condition 2 (SQLCipher triggers T1–T5); AES-256-GCM `em-os-enc-backup` key envelope (header authenticated as GCM AAD); synthetic restore drill `node scripts/backup-restore-drill.mjs` 18/18, plus negative checks per revised ADR §Decision 4 (bogus cipher / wrong format / wrong version / unknown artifact / tampered AAD header — added by qa `t_19def135`) | Storing sensitive data and declaring recovery ready |
| G-SEARCH-01 Semantic search | Deferred | Product + security + storage | Synthetic benchmark showing an FTS5 task gap, embedder metadata/reindex design, route/security/package approval | Adding embeddings/vector dependencies |
| G-SKILL-01 Existing Claude skills | Open | Product discovery | Scrubbed inventory, output contracts, location/ownership/license and compatibility assessment | Wrapping existing meeting/daily skills |

## Gate procedure

1. Link evidence from an approved private environment or add a scrubbed summary; never paste sensitive probe output here.
2. Update `State` to `Passed` or `Rejected`, date it, and name the approving role(s).
3. Record the exact allowed scope. Passing one route, source, OS, data class, or package version does not approve another.
4. If evidence changes (schema, scope, model, driver, policy, advisory), return the gate to `Open` and fail closed.
5. A rejected gate must name the selected fallback (for example, fixture-only connector or Node baseline).

## Release rule

An open gate is not necessarily an MVP code blocker: interfaces, synthetic fixtures, deterministic core behavior, and offline UI may proceed. It is a hard blocker for the capability named in `Unblocks`. Per `docs/PRODUCT_SPEC.md` §13, a release without G-MCP-01/G-SEC-01 and an applicable G-MODEL-01 remains explicitly a synthetic prototype, not a verified work integration. Per ADR 0008, an unencrypted-backup build (the current `backupTo()`/`writeExport()` plaintext paths) is likewise a synthetic prototype, not a verified recovery-ready release: the §13 recovery claim ("restore the local data from an encrypted backup") stays unverified until G-SEC-02's envelope is implemented and its drill passes on the artifact build.
