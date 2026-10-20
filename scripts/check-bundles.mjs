// Post-build check of the webview bundles (`packages/webview/dist/*.js`), which run under a
// strict CSP with no eval and no remote loads. Fails on:
//   - dynamic code: `new Function`, `Function(`, `eval(` (and any other bare `eval` reference);
//   - http(s) URLs, except W3C namespace URIs (SVG/MathML/XHTML/XLink/XML), which are
//     identifiers, not fetches.
// Also prints each bundle's size so a regression (e.g. zod creeping back in) is visible.
//
// CLI: `node scripts/check-bundles.mjs [dir]` (default `packages/webview/dist`). Exit 1 on any
// finding or if there are no bundles to check.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DYNAMIC_CODE = [
  { rule: "new-function", re: /\bnew\s+Function\b/g },
  { rule: "function-call", re: /(?<![\w$.])Function\s*\(/g },
  // Any bare reference to the global: `eval(…)`, and indirect `(0, eval)(…)` too.
  { rule: "eval", re: /(?<![\w$.])eval(?![\w$])/g },
];
const URL = /\bhttps?:\/\/[^\s"'`<>()\\]+/gi;
const ALLOWED_URL =
  /^http:\/\/www\.w3\.org\/(?:2000\/svg|1998\/Math\/MathML|1999\/xhtml|1999\/xlink|XML\/1998\/namespace|2000\/xmlns\/?)$/;

/**
 * Findings in a bundle's text, in order of appearance.
 * @param {string} text
 * @returns {Array<{ rule: string; match: string }>}
 */
export function findViolations(text) {
  const found = [];
  for (const { rule, re } of DYNAMIC_CODE) {
    for (const m of text.matchAll(re)) found.push({ rule, match: m[0], index: m.index });
  }
  for (const m of text.matchAll(URL)) {
    if (!ALLOWED_URL.test(m[0])) found.push({ rule: "url", match: m[0], index: m.index });
  }
  return found.sort((a, b) => a.index - b.index).map(({ rule, match }) => ({ rule, match }));
}

/** @param {number} n */
function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * @param {string[]} args
 * @returns {number} exit code
 */
export function main(args, cwd = process.cwd()) {
  const dir = resolve(cwd, args[0] ?? join("packages", "webview", "dist"));
  const files =
    existsSync(dir) && statSync(dir).isDirectory()
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".js"))
          .sort()
      : [];
  if (files.length === 0) {
    console.error(`check-bundles: no .js bundles in ${relative(cwd, dir) || dir} (run the build)`);
    return 1;
  }
  let violations = 0;
  for (const name of files) {
    const file = join(dir, name);
    const text = readFileSync(file, "utf8");
    const shown = relative(cwd, file).split(sep).join("/");
    console.log(`check-bundles: ${shown} ${kb(Buffer.byteLength(text))}`);
    for (const { rule, match } of findViolations(text)) {
      violations += 1;
      console.log(`${shown} ${rule} ${match}`);
    }
  }
  if (violations > 0) {
    console.error(`check-bundles: ${violations} violation(s).`);
    return 1;
  }
  console.log("check-bundles: ok");
  return 0;
}

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
