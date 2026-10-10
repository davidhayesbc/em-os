import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const requireText = (path, values) => {
  const text = read(path);
  for (const value of values) {
    if (!text.includes(value)) throw new Error(`${path} is missing required release marker: ${value}`);
  }
};

requireText(".github/workflows/ci.yml", ["macos-14", "macOS-arm64", "windows-latest", "Windows-x64", "npm ci", "npm run ci"]);
requireText(".gitignore", ["*.sqlite3", "Meeting-Notes/", "credentials.json", ".vscode/mcp.json", "exports/", "*.log"]);
requireText("docs/RELEASE_STATUS.md", ["Synthetic prototype", "UNVERIFIED / NO-GO", "Direct MCP Locker", "Approved work-model route"]);
requireText("docs/SYNTHETIC_RUNBOOK.md", ["npm ci", "npm run release:check", "npm run backup:drill", "EM OS: Sync"]);
requireText("docs/ENCRYPTED_BACKUP_DRILL.md", ["synthetic", "AES-256-GCM", "does not close"]);

const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const forbidden = tracked.filter((path) =>
  /(^|\/)(?:node_modules|dist|coverage|exports|logs|prompts|transcripts|Meeting-Notes|People|1-1s)(\/|$)/.test(path)
  || /(?:\.sqlite3?|\.db(?:-wal|-shm)?|\.env(?:\..*)?|credentials\.json|secrets\.json)$/i.test(path)
);
if (forbidden.length) throw new Error(`tracked release tree contains forbidden runtime/private artifacts: ${forbidden.join(", ")}`);

const fixtureViolations = tracked.filter((path) => path.startsWith("fixtures/") && !path.includes(".synthetic."));
if (fixtureViolations.length) throw new Error(`fixture is not explicitly synthetic: ${fixtureViolations.join(", ")}`);

console.log(`release manifest check: PASS (${tracked.length} tracked code/docs/synthetic-fixture files; required gates and CI targets documented)`);
