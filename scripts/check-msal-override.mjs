// Verifies the GHSA-xcx6-jx8p-x3h5 / CVE-2026-109461 remediation override.
//
// Run as part of `npm run ci` via `npm test`; the companion `.test.ts` imports the
// helper below so the check is exercised in every CI run.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);

const readJson = (file) => JSON.parse(readFileSync(join(repoRoot, file), "utf8"));

const semverGte = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return true;
};

export function checkMsalOverride() {
  const rootManifest = readJson("package.json");
  const override = rootManifest.overrides?.["@azure/msal-node"];
  if (!override) {
    throw new Error("package.json is missing the @azure/msal-node override");
  }

  const installed = readJson("node_modules/@azure/msal-node/package.json").version;
  if (!semverGte(installed, "7.1.0")) {
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
