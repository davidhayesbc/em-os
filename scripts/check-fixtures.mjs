// Repo-safety scan for checked-in fixtures: this is a public repo, so fixtures must be
// synthetic. Flags non-reserved email domains, non-reserved URL hosts, Slack-style
// workspace ids and Slack tokens.
//
// CLI: `node scripts/check-fixtures.mjs [dir]`
//   - with a dir: scans that directory only;
//   - without: scans `fixtures/` and `packages/*/fixtures/` under the cwd.
// Prints `file:line rule match` per violation and exits 1 if there are any.
// Missing directories are not an error (exit 0 with a note).
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const ALLOWED_EMAIL_DOMAIN = /^example\.(?:com|org|net)$/i;

const URL_AUTHORITY = /\b(?:https?|wss?):\/\/[^\s/?#<>"'`\\]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!)\]}]+$/;
const ALLOWED_URL_HOST = /^(?:(?:[a-z0-9-]+\.)*example\.(?:com|org|net)|localhost|127\.0\.0\.1)$/i;

const WORKSPACE_ID = /\bT0[0-9A-Z]{7,10}\b/g;
const SLACK_TOKEN = /xox[abpr]-/g;

function urlHost(url) {
  const authority = url.slice(url.indexOf("://") + 3);
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  return hostPort.replace(/:\d*$/, "").replace(/\.$/, "");
}

/**
 * Scan text for content that must not appear in public fixtures.
 * Pure and deterministic; findings are returned in order of appearance.
 * Slack tokens are reported by prefix only so a real secret is never echoed.
 * @param {string} text
 * @returns {Array<{ rule: string; match: string }>}
 */
export function scan(text) {
  const found = [];
  const add = (rule, match, index) => found.push({ rule, match, index });

  for (const m of text.matchAll(EMAIL)) {
    if (!ALLOWED_EMAIL_DOMAIN.test(m[1])) add("email-domain", m[0], m.index);
  }
  for (const m of text.matchAll(URL_AUTHORITY)) {
    const url = m[0].replace(TRAILING_PUNCTUATION, "");
    if (!ALLOWED_URL_HOST.test(urlHost(url))) add("url-host", url, m.index);
  }
  for (const m of text.matchAll(WORKSPACE_ID)) add("workspace-id", m[0], m.index);
  for (const m of text.matchAll(SLACK_TOKEN)) add("slack-token", m[0], m.index);

  return found.sort((a, b) => a.index - b.index).map(({ rule, match }) => ({ rule, match }));
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== ".git" && entry.name !== "node_modules") yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function defaultTargets(cwd) {
  const targets = [join(cwd, "fixtures")];
  const packages = join(cwd, "packages");
  if (existsSync(packages)) {
    for (const entry of readdirSync(packages, { withFileTypes: true })) {
      if (entry.isDirectory()) targets.push(join(packages, entry.name, "fixtures"));
    }
  }
  return targets.filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
}

/**
 * @param {string[]} args  CLI arguments (without node/script).
 * @returns {number} exit code
 */
export function main(args, cwd = process.cwd()) {
  const targets = args[0]
    ? [resolve(cwd, args[0])].filter((dir) => existsSync(dir) && statSync(dir).isDirectory())
    : defaultTargets(cwd);

  if (targets.length === 0) {
    console.log(
      `check-fixtures: no fixtures directory found (${args[0] ?? "fixtures"}); skipping.`,
    );
    return 0;
  }

  let violations = 0;
  for (const dir of targets) {
    for (const file of walk(dir)) {
      const bytes = readFileSync(file);
      if (bytes.includes(0)) continue; // binary
      const shown = relative(cwd, file).split(sep).join("/");
      const lines = bytes.toString("utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const { rule, match } of scan(line)) {
          violations += 1;
          console.log(`${shown}:${i + 1} ${rule} ${match}`);
        }
      });
    }
  }

  if (violations > 0) {
    console.error(`check-fixtures: ${violations} violation(s). Fixtures must be synthetic.`);
    return 1;
  }
  console.log("check-fixtures: ok");
  return 0;
}

// Node realpaths import.meta.url but not argv[1], so compare real paths: a symlinked
// invocation must still run the scan (failing open here would silently pass the gate).
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
