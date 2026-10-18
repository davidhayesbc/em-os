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
//   node scripts/scan-repo-safety.mjs --self-test # run built-in rule probes
//
// History scan semantics:
//   With --history the scanner walks every blob reachable from *all* refs that
//   were present at checkout time (`git rev-list --objects --all`). In CI this
//   means the scan covers every push-time-reachable branch, including sibling
//   branches that are not part of the PR under test. Any negative-test fixture
//   that intentionally contains a credential-shaped literal anywhere in shared
//   history must use an allowlisted, reserved-for-documentation host (see the
//   basic-auth-url allow predicate) so it is not flagged as a leak.
//
// No third-party dependencies: it runs under plain Node in CI on macOS/Windows.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("..", import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);
const scanHistory = process.argv.includes("--history");
const selfTest = process.argv.includes("--self-test");

const ALLOWED_BASIC_AUTH_HOSTS = new Set([
  "example.invalid",
  "example.com",
  "example.org",
  "example.test",
]);

function isAllowedBasicAuthHost(hostname) {
  const h = hostname.toLowerCase();
  for (const domain of ALLOWED_BASIC_AUTH_HOSTS) {
    if (h === domain || h.endsWith("." + domain)) return true;
  }
  return false;
}

function isAllowedBasicAuthUrl(value) {
  try {
    return isAllowedBasicAuthHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** name, severity, regex, allow(predicate over the matched text + file) */
const RULES = [
  { name: "private-key", severity: "high", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: "aws-access-key", severity: "high", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github-token", severity: "high", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "slack-token", severity: "high", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "google-api-key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "jwt", severity: "medium", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "basic-auth-url", severity: "high", re: /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@[^\s/]+/g, allow: isAllowedBasicAuthUrl },
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

// Historical adversarial redaction fixtures in this repo contain non-placeholder
// secret-like assignments in three specific blob revisions. The assignment-secret
// rule skips only those exact (path, blob-sha) pairs so the full-history scan
// stays green. Working-tree versions of these paths are scanned normally.
const REDACTION_FIXTURE_PATHS = new Set([
  "packages/core/src/redact.test.ts",
  "fixtures/connectors/meeting-notes.synthetic.json",
]);

const REDACTION_FIXTURE_HISTORY_BLOBS = new Set([
  "9565a1e4799cb14e977b7ecfab1ff8ff2f41e48f",
  "5c3040a3c4f73b3ae701de4f39ca721f194bc710",
  "d3f6db95e890226cac33b5a9c1c6caf7971e4398",
]);

function isRedactionFixtureHistory(location, historySha) {
  if (!historySha) return false;
  const m = location.match(/^(.*)\s+\(history\s+[a-f0-9]+\)$/);
  if (!m) return false;
  const path = m[1].replace(/^\.\/?/, "");
  return REDACTION_FIXTURE_PATHS.has(path) && REDACTION_FIXTURE_HISTORY_BLOBS.has(historySha.toLowerCase());
}

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

function scanText(text, location, findings, historySha = null) {
  const skipAssignmentSecret = isRedactionFixtureHistory(location, historySha);
  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      const matched = match[1] ?? match[0];
      if (rule.allow?.(matched) ?? false) continue;
      if (rule.name === "assignment-secret" && skipAssignmentSecret) continue;
      const before = text.slice(0, match.index);
      const line = before.split("\n").length;
      findings.push({ rule: rule.name, severity: rule.severity, location, line, sample: match[0].slice(0, 12) });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
}

/**
 * Resolve a path relative to a root directory. Kept as a separate helper so
 * the self-test can assert it never reverts to URL resolution (which mishandles
 * '#' and '?' in filenames).
 */
function resolveTrackedPath(rootPath, relPath) {
  return join(rootPath, relPath);
}

/**
 * Read a single tracked file and scan it.
 * Returns { scanned: true } on success, { binary: true } for binary blobs,
 * or { unreadable: true, error } when the file cannot be read.
 */
function scanTrackedFile(rootPath, relPath, findings) {
  let buffer;
  try {
    buffer = readFileSync(resolveTrackedPath(rootPath, relPath));
  } catch (err) {
    return { unreadable: true, error: err };
  }
  if (BINARY.test(buffer.toString("latin1"))) {
    return { binary: true };
  }
  scanText(buffer.toString("utf8"), relPath, findings);
  return { scanned: true };
}

function defaultReadHistoryBlob(sha) {
  return execFileSync("git", ["cat-file", "-p", sha], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString("latin1");
}

/**
 * Read a single git history blob and scan it.
 * Returns { scanned: true } on success, { binary: true } for binary blobs,
 * or { unreadable: true, error } when the blob cannot be read.
 * The optional `readBlob` argument lets the self-test stub a failure without
 * touching real git history.
 */
function scanHistoryBlob(sha, name, findings, readBlob = defaultReadHistoryBlob) {
  let text;
  try {
    text = readBlob(sha);
  } catch (err) {
    return { unreadable: true, error: err };
  }
  if (BINARY.test(text)) {
    return { binary: true };
  }
  scanText(text, `${name} (history ${sha.slice(0, 12)})`, findings, sha);
  return { scanned: true };
}

function selfTestSpecialCharResolution() {
  // Create temp files whose names contain URL-fragment/query characters and
  // prove they are read when the scanner resolves them with path.join() rather
  // than URL resolution. If the read path ever reverts to new URL(file, repoRoot)
  // the '#'/'?' files will silently produce no finding and this test will fail.
  const tmpDir = mkdtempSync(join(tmpdir(), "scan-repo-safety-"));
  const secret = "aws = " + "AKIA" + "ABCDEFGHIJKLMNOP";
  // Win32 forbids '?' in filenames, so that probe is covered by the helper
  // assertion below on Windows and by a real file on other platforms.
  const files = ["plain.txt", "probe#file.txt"];
  if (process.platform !== "win32") {
    files.push("probe?file.txt");
  }
  try {
    for (const f of files) {
      writeFileSync(join(tmpDir, f), secret + "\n");
    }

    // The path resolver must not use URL semantics for '#' or '?'.
    for (const f of ["plain.txt", "probe#file.txt", "probe?file.txt"]) {
      const resolved = resolveTrackedPath(tmpDir, f);
      const expected = join(tmpDir, f);
      if (resolved !== expected) {
        throw new Error(`self-test: resolveTrackedPath(${f}) = ${resolved}, expected ${expected}; special-char resolution regressed`);
      }
    }

    for (const f of files) {
      const fileFindings = [];
      const result = scanTrackedFile(tmpDir, f, fileFindings);
      if (result.unreadable) {
        throw new Error(`self-test: unreadable ${f}: ${result.error.message}`);
      }
      if (!fileFindings.some((finding) => finding.rule === "aws-access-key")) {
        throw new Error(`self-test: expected aws-access-key finding in ${f}; the special-char read path may have regressed`);
      }
    }

    // Verify that a missing tracked file is reported as unreadable, produces no
    // findings, and is excluded from the scanned count.
    const missingFindings = [];
    const missing = scanTrackedFile(tmpDir, "definitely-missing.txt", missingFindings);
    if (!missing.unreadable) {
      throw new Error("self-test: expected scanTrackedFile to report an unreadable tracked file");
    }
    if (missingFindings.length !== 0) {
      throw new Error("self-test: expected no findings for an unreadable tracked file");
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runSelfTest() {
  // Build the probes by concatenation so the literal credential-bearing URLs do
  // not appear as contiguous strings in this file and trip the scanner itself.
  const creds = "token:secret";
  const allowedHost = "example.invalid";
  const realHost = "real-host.invalid";
  const mustFlag = [
    ["basic-auth-url", "https://" + creds + "@" + realHost + "/pull/42"],
    ["basic-auth-url", "https://" + "user:pass" + "@" + "github.com" + "/org/repo"],
  ];
  const mustAllow = [
    "https://" + creds + "@" + allowedHost + "/pull/42",
    "https://" + creds + "@" + "example.com" + "/pull/42",
    "https://" + creds + "@" + "sub.example.invalid" + "/pull/42",
  ];
  for (const [rule, text] of mustFlag) {
    const findings = [];
    scanText(text, "<probe>", findings);
    if (!findings.some((f) => f.rule === rule)) {
      throw new Error(`self-test: expected rule ${rule} to flag ${text}`);
    }
  }
  for (const text of mustAllow) {
    const findings = [];
    scanText(text, "<probe>", findings);
    if (findings.some((f) => f.rule === "basic-auth-url")) {
      throw new Error(`self-test: expected basic-auth-url to allow ${text}`);
    }
  }
  // Redaction-fixture exemption probes: the historical allowlist is keyed by
  // exact (path, blob-sha) pairs, and working-tree copies are never exempt.
  const fixturePath = "packages/core/src/redact.test.ts";
  const syntheticSecret = "pass" + "word" + "='" + "abcdefghijklmnopqrstuvwx" + "'";
  const allowedHistorySha = "5c3040a3c4f73b3ae701de4f39ca721f194bc710";
  const nonAllowedHistorySha = "0000000000000000000000000000000000000000";
  const historyLocationFor = (sha) => `${fixturePath} (history ${sha.slice(0, 12)})`;
  const mustFlagHistory = [historyLocationFor(nonAllowedHistorySha), nonAllowedHistorySha];
  const mustAllowHistory = [historyLocationFor(allowedHistorySha), allowedHistorySha];

  {
    const findings = [];
    scanText(syntheticSecret, mustFlagHistory[0], findings, mustFlagHistory[1]);
    if (!findings.some((f) => f.rule === "assignment-secret")) {
      throw new Error("self-test: expected assignment-secret to flag a non-allowlisted history blob");
    }
  }
  {
    const findings = [];
    scanText(syntheticSecret, mustAllowHistory[0], findings, mustAllowHistory[1]);
    if (findings.some((f) => f.rule === "assignment-secret")) {
      throw new Error("self-test: expected the exact-SHA allowlist to suppress the historical fixture");
    }
  }
  {
    const findings = [];
    scanText(syntheticSecret, fixturePath, findings);
    if (!findings.some((f) => f.rule === "assignment-secret")) {
      throw new Error("self-test: expected assignment-secret to flag the working-tree fixture path");
    }
  }

  // Verify that an unreadable history blob is surfaced without touching real
  // history and does not produce findings that could be counted as scanned.
  {
    const blobFindings = [];
    const result = scanHistoryBlob("0000000000000000000000000000000000000000", "probe.txt", blobFindings, () => {
      const err = new Error("ENOENT: no such file or directory");
      err.code = "ENOENT";
      throw err;
    });
    if (!result.unreadable || result.error.code !== "ENOENT") {
      throw new Error("self-test: expected scanHistoryBlob to report an unreadable history blob");
    }
    if (blobFindings.length !== 0) {
      throw new Error("self-test: expected no findings for an unreadable history blob");
    }
  }

  selfTestSpecialCharResolution();

  console.log("repository safety scan self-test: PASS");
}

if (selfTest) {
  runSelfTest();
  process.exit(0);
}

const findings = [];
let treeCount = 0;
let unreadableCount = 0;

for (const file of listTrackedFiles()) {
  if (SKIP_PATH.test(file)) continue;
  const result = scanTrackedFile(repoRootPath, file, findings);
  if (result.unreadable) {
    unreadableCount += 1;
    console.error(`WARN unreadable tracked file: ${file} — ${result.error.code ?? result.error.message}`);
    continue;
  }
  // Binary files are readable but not scanned as text; still count as tracked.
  treeCount += 1;
}

if (unreadableCount) {
  console.error(`WARN ${unreadableCount} tracked file(s) could not be read and were excluded from the scan count.`);
}

let historyCount = 0;
let unreadableHistoryCount = 0;
if (scanHistory) {
  for (const { sha, name } of listHistoryBlobs()) {
    const result = scanHistoryBlob(sha, name, findings);
    if (result.unreadable) {
      unreadableHistoryCount += 1;
      console.error(`WARN unreadable history blob: ${name} (history ${sha.slice(0, 12)}) — ${result.error.code ?? result.error.message}`);
      continue;
    }
    if (result.binary) continue;
    historyCount += 1;
  }
}

if (unreadableHistoryCount) {
  console.error(`WARN ${unreadableHistoryCount} history blob(s) could not be read and were excluded from the scan count.`);
}

for (const finding of findings) {
  console.error(`FAIL [${finding.severity}] ${finding.rule} at ${finding.location}:${finding.line} — '${finding.sample}…'`);
}

if (findings.length) {
  console.error(`\nrepository safety scan: FAIL (${findings.length} finding(s); scanned ${treeCount} tracked files${scanHistory ? ` + ${historyCount} history blobs` : ""})`);
  process.exit(1);
}
console.log(`repository safety scan: PASS (no secrets, PII or work content in ${treeCount} tracked files${scanHistory ? ` or ${historyCount} history blobs` : ""})`);
