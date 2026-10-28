// Verifies the GHSA-xcx6-jx8p-x3h5 / CVE-2026-109461 remediation override.
//
// Run as part of `npm run ci` via `npm test`; the companion `.test.ts` imports the
// helpers below so the check is exercised in every CI run.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Only accept stable, dot-separated releases: major.minor.patch with no
// prerelease/build metadata. This keeps the guard from failing open on
// strings like "7.1.0-beta.0" or "not-a-version".
const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Only accept caret ranges that pin a stable lower bound, e.g. ^7.1.2.
const CARET_RANGE_RE = /^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Shared stable parser used for installed versions and caret lower bounds.
// Rejects components that are not safe integers so arbitrary-length digit
// strings cannot round, overflow to Infinity, or bypass the caret comparison.
function parseStableTriple(version) {
  if (typeof version !== "string") {
    return null;
  }
  const match = STABLE_VERSION_RE.exec(version);
  if (!match) {
    return null;
  }
  const components = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!components.every(Number.isSafeInteger)) {
    return null;
  }
  return components;
}

export function parseStableVersion(version) {
  return parseStableTriple(version);
}

export function stableGte(a, b) {
  const parsedA = parseStableVersion(a);
  const parsedB = parseStableVersion(b);
  if (!parsedA || !parsedB) {
    // Fail closed: malformed, prerelease, or oversized versions never satisfy a
    // stable comparison.
    return false;
  }
  for (let i = 0; i < 3; i++) {
    if (parsedA[i] > parsedB[i]) return true;
    if (parsedA[i] < parsedB[i]) return false;
  }
  return true;
}

export function parseCaretRange(range) {
  if (typeof range !== "string") {
    return null;
  }
  const match = CARET_RANGE_RE.exec(range);
  if (!match) {
    return null;
  }
  const lowerBound = `${match[1]}.${match[2]}.${match[3]}`;
  return parseStableTriple(lowerBound);
}

export function caretSatisfies(version, range) {
  const parsedVersion = parseStableVersion(version);
  const parsedRange = parseCaretRange(range);
  if (!parsedVersion || !parsedRange) {
    return false;
  }
  // ^X.Y.Z allows changes that do not modify the left-most non-zero digit.
  // For X > 0 that means >= X.Y.Z and < (X+1).0.0.
  if (parsedVersion[0] !== parsedRange[0]) {
    return false;
  }
  return stableGte(version, `${parsedRange[0]}.${parsedRange[1]}.${parsedRange[2]}`);
}

export function isValidMsalOverride(override) {
  const parsedRange = parseCaretRange(override);
  if (!parsedRange) {
    return false;
  }
  const lowerBound = `${parsedRange[0]}.${parsedRange[1]}.${parsedRange[2]}`;
  // Advisory GHSA-xcx6-jx8p-x3h5 patched range starts at 7.1.0.
  return stableGte(lowerBound, "7.1.0");
}

export function checkMsalOverride(repoRoot = dirname(here)) {
  const readManifest = (file) => JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
  const rootManifest = readManifest("package.json");
  const override = rootManifest.overrides?.["@azure/msal-node"];
  if (!override) {
    throw new Error("package.json is missing the @azure/msal-node override");
  }

  if (!isValidMsalOverride(override)) {
    throw new Error(
      `Invalid @azure/msal-node override: ${override}; expected ^X.Y.Z with stable lower bound >= 7.1.0`,
    );
  }

  const installed = readManifest("node_modules/@azure/msal-node/package.json").version;
  if (!parseStableVersion(installed)) {
    throw new Error(`Installed @azure/msal-node version ${installed} is not a stable release`);
  }
  if (!caretSatisfies(installed, override)) {
    throw new Error(
      `Overridden @azure/msal-node is ${installed}; expected a stable version satisfying ${override}`,
    );
  }
  if (!stableGte(installed, "7.1.0")) {
    throw new Error(
      `Overridden @azure/msal-node is ${installed}; expected >= 7.1.0 (advisory patched range)`,
    );
  }

  return { override, installed };
}

if (import.meta.main) {
  try {
    const { override, installed } = checkMsalOverride();
    process.stdout.write(`check-msal-override: ${installed} (override ${override})\n`);
  } catch (e) {
    process.stderr.write(`check-msal-override: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
}
