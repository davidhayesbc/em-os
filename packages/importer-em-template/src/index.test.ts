import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const fixtureDir = join(import.meta.dirname, "../fixtures");
const workspaceDir = join(fixtureDir, "workspace");
const mtimesPath = join(fixtureDir, "mtimes.json");

function* walkMarkdown(dir: string, skip = new Set([".git", "node_modules"])): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) yield* walkMarkdown(path, skip);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield path;
    }
  }
}

function allWorkspaceFiles(): string[] {
  return [...walkMarkdown(workspaceDir)].sort();
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

const IMPORT_DATE = new Date("2026-10-20T00:00:00Z");
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function relativeToFixture(path: string): string {
  return relative(fixtureDir, path).split("\\").join("/");
}

function parseExpectedTable(): Map<string, number> {
  const expected = readText(join(fixtureDir, "EXPECTED.md"));
  const counts = new Map<string, number>();
  for (const line of expected.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|/);
    if (!match) continue;
    const key = match[1]!.trim();
    const value = Number.parseInt(match[2]!, 10);
    counts.set(key, value);
  }
  return counts;
}

function readFrontmatterAliases(text: string): string[] {
  if (!text.startsWith("---")) return [];
  const end = text.search(/\r?\n---\r?\n/);
  if (end === -1) return [];
  const fm = text.slice(3, end);
  const aliasesMatch = fm.match(/aliases:\s*\[(.*?)\]/s);
  if (!aliasesMatch) return [];
  return aliasesMatch[1]!
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function readName(text: string): string | undefined {
  const match = text.match(/\*\*Name:\*\*\s*(.+)/);
  return match?.[1]?.trim();
}

function fileIdentities(text: string): string[] {
  const ids: string[] = [];
  ids.push(...readFrontmatterAliases(text));
  const chat = text.match(/Chat:\s*@(\S+)/);
  if (chat) ids.push(chat[1]!);
  const codeHost = text.match(/Code host:\s*(\S+)/);
  if (codeHost) ids.push(codeHost[1]!);
  const email = text.match(/Email:\s*(\S+)/);
  if (email) ids.push(email[1]!);
  return ids;
}

function derivePersonsAndIdentities(): { persons: number; identities: number } {
  const peopleDir = join(workspaceDir, "People");
  const stakeholdersDir = join(workspaceDir, "Stakeholders");
  const peopleFiles = existsSync(peopleDir)
    ? readdirSync(peopleDir)
        .filter((n) => n.endsWith(".md"))
        .map((n) => join(peopleDir, n))
    : [];
  const stakeholderFiles = existsSync(stakeholdersDir)
    ? readdirSync(stakeholdersDir)
        .filter((n) => n.endsWith(".md"))
        .map((n) => join(stakeholdersDir, n))
    : [];

  const byName = new Map<string, { identities: Set<string>; origins: Set<string> }>();
  for (const file of peopleFiles) {
    const text = readText(file);
    const name = readName(text);
    if (!name) continue;
    const entry = byName.get(name) ?? { identities: new Set<string>(), origins: new Set<string>() };
    entry.origins.add("people");
    for (const id of fileIdentities(text)) entry.identities.add(id);
    byName.set(name, entry);
  }
  for (const file of stakeholderFiles) {
    const text = readText(file);
    const name = readName(text);
    if (!name) continue;
    const entry = byName.get(name) ?? { identities: new Set<string>(), origins: new Set<string>() };
    entry.origins.add("stakeholder");
    for (const id of fileIdentities(text)) entry.identities.add(id);
    byName.set(name, entry);
  }

  return {
    persons: byName.size,
    identities: [...byName.values()].reduce((sum, e) => sum + e.identities.size, 0),
  };
}

function countFilesInDir(dir: string, predicate: (name: string) => boolean = () => true): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((n) => n.endsWith(".md") && predicate(n)).length;
}

function countFilesRecursive(
  dir: string,
  predicate: (relPath: string) => boolean = () => true,
): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(path, predicate);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const rel = relative(workspaceDir, path).split("\\").join("/");
      if (predicate(rel)) count++;
    }
  }
  return count;
}

function deriveMeetings(): number {
  const oneOnOnes = countFilesRecursive(join(workspaceDir, "1-1s"));
  const standups = countFilesInDir(join(workspaceDir, "Daily-Logs/Standups"));
  return oneOnOnes + standups;
}

function deriveSourceItems(files: string[]): number {
  const oneOnOnes = countFilesRecursive(join(workspaceDir, "1-1s"));
  const standups = countFilesInDir(join(workspaceDir, "Daily-Logs/Standups"));
  const dailyLogs = countFilesInDir(join(workspaceDir, "Daily-Logs"), (n) =>
    /^\d{4}-\d{2}-\d{2}\.md$/.test(n),
  );
  const weeklySummaries = countFilesInDir(join(workspaceDir, "Weekly-Summaries"));
  const reports = countFilesInDir(join(workspaceDir, "Reports"));
  const decisions = countFilesInDir(join(workspaceDir, "Decisions"));

  let dailyLogMeetings = 0;
  for (const file of files) {
    const rel = relative(workspaceDir, file).split("\\").join("/");
    if (!/^Daily-Logs\/\d{4}-\d{2}-\d{2}\.md$/.test(rel)) continue;
    const text = readText(file);
    if (/## Meeting — .+ \(\d{4}-\d{2}-\d{2}\)/.test(text)) dailyLogMeetings++;
  }

  return (
    oneOnOnes + standups + dailyLogs + weeklySummaries + reports + decisions + dailyLogMeetings
  );
}

function deriveGoals(): number {
  return countFilesInDir(join(workspaceDir, "Workstreams"));
}

function deriveDecisions(): number {
  return countFilesInDir(join(workspaceDir, "Decisions"));
}

function deriveRisks(): number {
  const path = join(workspaceDir, "Risks/risk-register.md");
  if (!existsSync(path)) return 0;
  const text = readText(path);
  const matches = [...text.matchAll(/^\|\s*(R\d+)\s*\|/gm)];
  return matches.length;
}

function deriveDocuments(): number {
  return (
    countFilesInDir(join(workspaceDir, "My-Growth")) +
    countFilesInDir(join(workspaceDir, "JobDescriptions"))
  );
}

function deriveDrafts(): number {
  return (
    countFilesInDir(join(workspaceDir, "Weekly-Summaries")) +
    countFilesInDir(join(workspaceDir, "Reports"))
  );
}

function fileMtimeMs(relPath: string, mtimes: Record<string, string>): number {
  const key = relativeToFixture(join(workspaceDir, relPath));
  const value = mtimes[key];
  return value ? Date.parse(value) : 0;
}

function isFileRecent(relPath: string, mtimes: Record<string, string>): boolean {
  const mtime = fileMtimeMs(relPath, mtimes);
  return mtime > 0 && IMPORT_DATE.getTime() - mtime <= RECENT_WINDOW_MS;
}

function isUserOwned(line: string, fileRel: string): boolean {
  const beforeTags = line.split("<!--")[0] ?? line;
  // Any explicit non-self person (wiki-link or bare name) makes it other-owned.
  if (/\[\[People\/[^\]|]+\|[^\]]+\]\]\s*:/.test(beforeTags)) return false;
  if (/\b(Alex|Sam|Zoë|Zoe|Jordan|Priya)\s*:/.test(beforeTags)) return false;
  // me: or absent owner resolves to the fixture user.
  if (/\bme\s*:/.test(beforeTags)) return true;
  // Placeholder "them:" resolves from the file's subject. In Todos.md the subject is the self person.
  if (/\bthem\s*:/.test(beforeTags) && fileRel === "Todos.md") return true;
  // Owed-to-me markers are treated as user-owned for activation.
  if (/!(blocked|waiting-)/.test(line)) return true;
  return true;
}

function hasActivationTag(line: string): boolean {
  return /!(\d{4}-\d{2}-\d{2}|p[0-3]|now|next|soon|later|someday|blocked|waiting-)/.test(line);
}

function deriveCommitments(
  files: string[],
  mtimes: Record<string, string>,
): { active: number; dropped: number; done: number; unparseable: number } {
  const result = { active: 0, dropped: 0, done: 0, unparseable: 0 };
  for (const file of files) {
    const rel = relative(workspaceDir, file).split("\\").join("/");
    // Generated TODO.md is skipped as a whole; real commitments live in Todos.md.
    if (rel === "TODO.md") continue;
    const lines = readText(file).split(/\r?\n/);
    const recent = isFileRecent(rel, mtimes);
    for (const line of lines) {
      const checkbox = line.match(/^-\s*\[(x| )\]\s*(.*)$/);
      if (!checkbox) continue;
      const checked = checkbox[1] === "x";
      const rest = checkbox[2]!;
      const hasId = /<!--\s*id:/.test(rest);
      if (!hasId) {
        result.unparseable++;
        continue;
      }
      if (checked) {
        result.done++;
        continue;
      }
      const userOwned = isUserOwned(rest, rel);
      if (userOwned && (hasActivationTag(rest) || recent)) {
        result.active++;
      } else {
        result.dropped++;
      }
    }
  }
  return result;
}

describe("importer-em-template fixture workspace", () => {
  const mtimes = JSON.parse(readText(mtimesPath)) as Record<string, string>;
  const workspaceFiles = allWorkspaceFiles();

  it("every mtimes.json key resolves to an existing file under fixtures/workspace/", () => {
    for (const key of Object.keys(mtimes)) {
      const full = join(fixtureDir, key);
      expect(existsSync(full) && statSync(full).isFile()).toBe(true);
    }
  });

  it("every file under fixtures/workspace/ has a pin in mtimes.json", () => {
    const pinned = new Set(Object.keys(mtimes));
    for (const file of workspaceFiles) {
      const rel = relative(fixtureDir, file).split("\\").join("/");
      expect(pinned.has(rel)).toBe(true);
    }
  });

  it("every pin parses as an ISO-8601 instant", () => {
    const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
    for (const [_key, value] of Object.entries(mtimes)) {
      expect(value).toMatch(isoInstant);
      const parsed = Date.parse(value);
      expect(Number.isFinite(parsed)).toBe(true);
    }
  });

  it("has the plan inventory", () => {
    const byDir: Record<string, string[]> = {};
    for (const file of workspaceFiles) {
      const rel = relative(workspaceDir, file).split("\\").join("/");
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".";
      if (!byDir[dir]) byDir[dir] = [];
      byDir[dir].push(rel);
    }

    expect(byDir.People?.length).toBe(3);
    expect(byDir.Stakeholders?.length).toBe(3);

    const oneOnOneDirs = Object.keys(byDir).filter((d) => d.startsWith("1-1s/"));
    expect(oneOnOneDirs.length).toBe(2);
    expect(oneOnOneDirs.flatMap((d) => byDir[d]).length).toBe(4);

    const standupFiles = byDir["Daily-Logs/Standups"] ?? [];
    expect(standupFiles.length).toBe(3);
    expect(standupFiles.some((f) => f.includes("-multifecta"))).toBe(true);

    const dailyLogFiles = byDir["Daily-Logs"] ?? [];
    const dailyLogs = dailyLogFiles.filter((f) =>
      /^\d{4}-\d{2}-\d{2}\.md$/.test(f.split("/").pop() ?? ""),
    );
    expect(dailyLogs.length).toBe(3);

    expect(byDir["Weekly-Summaries"]?.length).toBe(1);

    const topLevel = new Set(byDir["."] ?? []);
    expect(topLevel.has("TODO.md")).toBe(true);
    expect(topLevel.has("Todos.md")).toBe(true);

    expect(byDir.Risks?.length).toBe(1);
    expect(byDir.Workstreams?.length).toBeGreaterThanOrEqual(1);
    expect(byDir.Decisions?.length).toBeGreaterThanOrEqual(1);
    expect(byDir.Systems?.length).toBe(1);
    expect(topLevel.has("Acronyms.md")).toBe(true);
    expect(byDir["My-Growth"]?.length).toBe(1);
    expect(byDir.JobDescriptions?.length).toBeGreaterThanOrEqual(1);
    expect(byDir["Team-Health"]?.length).toBeGreaterThanOrEqual(1);
    expect(byDir.Reports?.length).toBeGreaterThanOrEqual(1);
  });

  it("preserves CRLF drift in Stakeholders/jordan-patel.md", () => {
    const bytes = readFileSync(join(workspaceDir, "Stakeholders/jordan-patel.md"));
    expect(bytes.includes(Buffer.from("\r\n"))).toBe(true);
  });

  it("exercises the todo grammar in Todos.md", () => {
    const todos = readText(join(workspaceDir, "Todos.md"));

    // Priority, urgency, deferred, blocked/waiting, due-date, workstream, supersedes, arbitrary tag.
    for (const tag of [
      "!p0",
      "!p1",
      "!p2",
      "!p3",
      "!now",
      "!next",
      "!soon",
      "!later",
      "!someday",
      "!blocked",
      "!waiting-Alex",
      "!2026-10-25",
      "#ws:api-cleanup",
      "#supersedes:c3d4e5",
      "#tag:imported",
    ]) {
      expect(todos).toContain(tag);
    }

    // At least one line with two id markers.
    expect(todos).toMatch(/id:[^\s]+ id:[^\s]+/);

    // Unparseable line remains.
    expect(todos).toContain("not a valid todo line");
  });

  it("has at least one file ending with a gemini-thread-id marker", () => {
    let found = false;
    for (const file of workspaceFiles) {
      const text = readText(file).trimEnd();
      if (text.endsWith("-->") && text.includes("gemini-thread-id")) {
        const lastLine = text.split(/\r?\n/).pop() ?? "";
        if (lastLine.includes("gemini-thread-id")) {
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("has daily logs with auto-today, auto-scheduled and meeting headings", () => {
    let found = false;
    for (const file of workspaceFiles) {
      const rel = relative(workspaceDir, file).split("\\").join("/");
      if (!rel.match(/^Daily-Logs\/\d{4}-\d{2}-\d{2}\.md$/)) continue;
      const text = readText(file);
      if (
        text.includes("<!-- BEGIN auto-today -->") &&
        text.includes("<!-- END auto-today -->") &&
        text.includes("<!-- BEGIN auto-scheduled -->") &&
        text.includes("<!-- END auto-scheduled -->") &&
        /## Meeting — .+ \(\d{4}-\d{2}-\d{2}\)/.test(text)
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("uses 6-char ids for every todo marker, keying on the last id on two-id lines", () => {
    for (const file of workspaceFiles) {
      const lines = readText(file).split(/\r?\n/);
      for (const line of lines) {
        // Match only the standard todo id comment, capturing the last id on two-id lines.
        const match = line.match(/<!--\s*(?:id:\S+\s+)*id:(\S+)\s*-->/);
        if (!match) continue;
        expect(match[1]).toMatch(/^[a-z0-9]{6}$/);
      }
    }
  });

  it("EXPECTED.md entity counts re-derive from the fixture tree", () => {
    const expected = parseExpectedTable();

    const { persons, identities } = derivePersonsAndIdentities();
    expect(persons).toBe(expected.get("persons"));
    expect(identities).toBe(expected.get("identities"));

    expect(deriveMeetings()).toBe(expected.get("meetings"));
    expect(deriveSourceItems(workspaceFiles)).toBe(expected.get("source_items"));
    expect(deriveGoals()).toBe(expected.get("goals"));
    expect(deriveDecisions()).toBe(expected.get("decisions"));
    expect(deriveRisks()).toBe(expected.get("risks"));
    expect(deriveDocuments()).toBe(expected.get("documents"));
    expect(deriveDrafts()).toBe(expected.get("drafts"));

    const commitments = deriveCommitments(workspaceFiles, mtimes);
    expect(commitments.active).toBe(expected.get("commitments (active)"));
    expect(commitments.dropped).toBe(expected.get("commitments (dropped)"));
    expect(commitments.done).toBe(expected.get("commitments (done)"));
    expect(commitments.unparseable).toBe(expected.get("Unparseable todo line"));
  });
});
