// Repository safety scan for the public em-os repo.
//
// EM OS is a public repository: it must contain code, schemas, docs and
// synthetic fixtures ONLY. This scanner fails the build if a tracked file (in
// the working tree, and optionally in full git history) looks like it carries
// a credential, a real personal identifier, or non-synthetic work content.
//
// Usage:
//   node scripts/scan-repo-safety.mjs            # scan tracked working tree
//   node scripts/scan-repo-safety.mjs --history  # also scan every blob in history
//
// No third-party dependencies: it runs under plain Node in CI on macOS/Windows.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repoRoot = new URL("..", import.meta.url);
const scanHistory = process.argv.includes("--history");

/** name, severity, regex, allow(predicate over the matched text + file) */
const RULES = [
  { name: "private-key", severity: "high", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: "aws-access-key", severity: "high", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", severity: "high", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "slack-token", severity: "high", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-api-key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "jwt", severity: "medium", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "basic-auth-url", severity: "high", re: /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@[^\s/]+/g },
  {
    name: "assignment-secret",
    severity: "medium",
    // key/token/password/secret assigned to a literal that is not obviously a placeholder.
    re: /\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi,
    allow: (value) => /redacted|example|placeholder|synthetic|test|dummy|change[_-]?me|xxx+|your[_-]|<.+>|\$\{|\.\.\./i.test(value),
  },
  {
    name: "email-address",
    severity: "medium",
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    allow: (value) => /\.(?:invalid|test|example|localhost)$/i.test(value) || /@example\.(?:com|org|net)$/i.test(value),
  },
  {
    name: "work-host",
    severity: "low",
    // Non-public corporate hosts / cloud tenants that should never be hard-coded.
    re: /\b[a-z0-9-]+\.(?:atlassian\.net|slack\.com|sharepoint\.com|myworkday\.com|okta\.com|amazonaws\.com)\b/gi,
    allow: (value) => /example\.invalid$/i.test(value),
  },
];

const SKIP_PATH = /(^|\/)(?:node_modules|\.git|dist|coverage|\.worktrees)(\/|$)/;
const BINARY = /\0/;

function listTrackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function listHistoryBlobs() {
  const seen = new Set();
  const out = [];
  const lines = execFileSync("git", ["rev-list", "--objects", "--all"], { cwd: repoRoot, encoding: "utf8" }).split("\n");
  for (const line of lines) {
    const [sha, name] = line.split(" ", 2);
    if (!sha || !name) continue;
    if (SKIP_PATH.test(name) || seen.has(sha)) continue;
    seen.add(sha);
    out.push({ sha, name });
  }
  return out;
}

function scanText(text, location, findings) {
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      const matched = match[1] ?? match[0];
      if (rule.allow?.(matched) ?? false) continue;
      const before = text.slice(0, match.index);
      const line = before.split("\n").length;
      findings.push({ rule: rule.name, severity: rule.severity, location, line, sample: match[0].slice(0, 12) });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

const findings = [];

for (const file of listTrackedFiles()) {
  if (SKIP_PATH.test(file)) continue;
  let buffer;
  try { buffer = readFileSync(new URL(file, repoRoot)); } catch { continue; }
  if (BINARY.test(buffer.toString("latin1"))) continue;
  scanText(buffer.toString("utf8"), file, findings);
}
const treeCount = listTrackedFiles().filter((f) => !SKIP_PATH.test(f)).length;

let historyCount = 0;
if (scanHistory) {
  for (const { sha, name } of listHistoryBlobs()) {
    let text;
    try { text = execFileSync("git", ["cat-file", "-p", sha], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString("latin1"); } catch { continue; }
    if (BINARY.test(text)) continue;
    historyCount += 1;
    scanText(text, `${name} (history ${sha.slice(0, 12)})`, findings);
  }
}

for (const finding of findings) {
  console.error(`FAIL [${finding.severity}] ${finding.rule} at ${finding.location}:${finding.line} — '${finding.sample}…'`);
}

if (findings.length) {
  console.error(`\nrepository safety scan: FAIL (${findings.length} finding(s); scanned ${treeCount} tracked files${scanHistory ? ` + ${historyCount} history blobs` : ""})`);
  process.exit(1);
}
console.log(`repository safety scan: PASS (no secrets, PII or work content in ${treeCount} tracked files${scanHistory ? ` or ${historyCount} history blobs` : ""})`);
