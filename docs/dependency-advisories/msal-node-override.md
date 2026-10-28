# MSAL Node advisory override: GHSA-xcx6-jx8p-x3h5 / CVE-2026-109461

## Summary

A root `package.json` `overrides` entry forces transitive `@azure/msal-node` to
`^7.1.2`, resolving the development-only advisory GHSA-xcx6-jx8p-x3h5 /
CVE-2026-109461 without waiting for `@vscode/vsce` or `@azure/identity` to
publish a compatible patched chain.

The caret constraint allows npm to resolve any stable `7.x.x` release that is
`>= 7.1.2`, while `package-lock.json` currently pins the exact tested version
`7.1.2`. The official patched range for the advisory starts at `7.1.0`; `7.1.2` is
the selected, tested patched version.

## Affected chain (development only)

```text
em-os extension dev dependency
└── @vscode/vsce@^4.0.0
    └── @azure/identity@^4.13.2
        └── @azure/msal-node@^6.0.0   ← vulnerable range
```

- `@azure/msal-node` `^6.0.0` resolves to a version in the advisory range
  `>=5.0.0-beta.0 <7.1.0`.
- The extension's production dependencies do not import Azure or MSAL code.
- CI packaging uses `vsce ls/package --no-dependencies`, so the published VSIX never
  contains the vsce dependency tree.

## Severity classification distinctions

| Source | Rating | CVSS |
|--------|--------|------|
| npm / GitHub Global Advisory Database | high | 7.5 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`) |
| AzureAD repository advisory (GHSA-xcx6-jx8p-x3h5) | moderate | 5.9 (`CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`) |

Both ratings are preserved in project records.

## Why an override is justified

1. **No compatible upstream chain exists yet.**
   - `@azure/identity@4.14.0` (latest stable known at override date) still
     requires `@azure/msal-node ^6.0.0`.
   - `@vscode/vsce@4.1.0` (latest stable known at override date) still requires
     `@azure/identity ^4.13.2`.
   - `npm audit fix --dry-run --ignore-scripts` leaves the advisory unchanged.

2. **The extension does not exercise the vulnerable code path.**
   - No application code imports `@azure/identity` or `@azure/msal-node`.
   - The only use of `vsce` is `ls` and `package --no-dependencies`.
   - `vsce` auth code uses a chained non-authorization-code credential flow.
   - The advisory specifically affects `acquireTokenByCode` / authorization-code flow.

3. **The override is narrowly scoped.**
   - Only `@azure/msal-node` is overridden to `^7.1.2`.
   - `7.1.2` is the selected, tested patched version; the advisory's first
     patched release is `7.1.0`.
   - No application or production dependency constraints are changed.

4. **The override is tested.**
   - `npm ci` installs `@azure/msal-node@7.1.2`.
   - `npm audit` reports zero vulnerabilities.
   - `npm audit --omit=dev` reports zero vulnerabilities.
   - `npm run ci` passes (lint, fixtures, docs, build, bundles, typecheck, tests).
   - `npm run package -- --target darwin-arm64` produces a valid VSIX using `vsce`.

## Verification

Check the installed chain:

```bash
npm explain @azure/msal-node
```

Expected output (approximately):

```text
@azure/msal-node@7.1.2 dev
node_modules/@azure/msal-node
  overridden @azure/msal-node@"^7.1.2" (was "^6.0.0") from @azure/identity@4.14.0
```

Check audits:

```bash
npm audit                    # full audit: zero vulnerabilities
npm audit --omit=dev         # production audit: zero vulnerabilities
```

## Risk and review cadence

- The override is a **temporary dependency-hygiene measure**, not a permanent
  architectural decision.
- Re-evaluate when `@azure/identity` publishes a stable version that depends on
  `@azure/msal-node >= 7.1.0` or when `@vscode/vsce` no longer pulls in the vulnerable
  chain. At that point the override can be removed and a normal `npm update` used.
- If the project ever starts using `vsce publish` or any Azure authorization-code flow,
  the override must be re-verified against that usage with explicit security review.
- The `@azure/msal-node` override and its upstream chain are reviewed by the
  dependency-review owner as part of every `package.json`/`package-lock.json`
  change, and re-checked at least monthly during active development (or whenever
  `npm audit` reports a new advisory).
