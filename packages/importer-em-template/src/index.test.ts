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
    const [, key, value] = match;
    if (key === undefined || value === undefined) continue;
    counts.set(key.trim(), Number.parseInt(value, 10));
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
  const [, content] = aliasesMatch;
  if (content === undefined) return [];
  return content
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
  if (chat) {
    const [, handle] = chat;
    if (handle) ids.push(handle);
  }
  const codeHost = text.match(/Code host:\s*(\S+)/);
  if (codeHost) {
    const [, handle] = codeHost;
    if (handle) ids.push(handle);
  }
  const email = text.match(/Email:\s*(\S+)/);
  if (email) {
    const [, handle] = email;
    if (handle) ids.push(handle);
  }
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

function countDailyLogMeetingSections(files: string[]): number {
  let count = 0;
  const headingRe = /^## Meeting — .+ \(\d{4}-\d{2}-\d{2}\)$/gm;
  for (const file of files) {
    const rel = relative(workspaceDir, file).split("\\").join("/");
    if (!/^Daily-Logs\/\d{4}-\d{2}-\d{2}\.md$/.test(rel)) continue;
    const text = readText(file);
    count += [...text.matchAll(headingRe)].length;
  }
  return count;
}

function deriveMeetings(files: string[]): number {
  const oneOnOnes = countFilesRecursive(join(workspaceDir, "1-1s"));
  const standups = countFilesInDir(join(workspaceDir, "Daily-Logs/Standups"));
  return oneOnOnes + standups + countDailyLogMeetingSections(files);
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

  return (
    oneOnOnes +
    standups +
    dailyLogs +
    weeklySummaries +
    reports +
    decisions +
    countDailyLogMeetingSections(files)
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

function countBulletsUnderSections(text: string, sectionTitles: Set<string>): number {
  let count = 0;
  let active = false;
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      active = sectionTitles.has(heading[1]?.trim() ?? "");
      continue;
    }
    if (active && /^\s*-\s+/.test(line)) count++;
  }
  return count;
}

function derivePersonNotes(): number {
  const personNoteSections = new Set([
    "Running contribution notes",
    "Context on them",
    "Six-month rollup",
    "Comms preferences",
    "How they like feedback",
  ]);
  let count = 0;
  const peopleDir = join(workspaceDir, "People");
  const stakeholdersDir = join(workspaceDir, "Stakeholders");
  for (const dir of [peopleDir, stakeholdersDir]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const text = readText(join(dir, name));
      count += countBulletsUnderSections(text, personNoteSections);
    }
  }
  const teamHealthDir = join(workspaceDir, "Team-Health");
  if (existsSync(teamHealthDir)) {
    const knownPerson = /(?<![A-Za-z0-9])(Alex|Sam|Zoë|Zoe|Jordan|Priya)(?![A-Za-z0-9])/;
    for (const name of readdirSync(teamHealthDir)) {
      if (!name.endsWith(".md")) continue;
      const lines = readText(join(teamHealthDir, name)).split(/\r?\n/);
      for (const line of lines) {
        if (/^\s*-\s+/.test(line) && !/^\s*-\s*\[/.test(line) && knownPerson.test(line)) count++;
      }
    }
  }
  return count;
}

function derivePeopleGrowthGoals(): number {
  let count = 0;
  const peopleDir = join(workspaceDir, "People");
  if (!existsSync(peopleDir)) return 0;
  for (const name of readdirSync(peopleDir)) {
    if (!name.endsWith(".md")) continue;
    const text = readText(join(peopleDir, name));
    count += countBulletsUnderSections(text, new Set(["Growth goals"]));
  }
  return count;
}

function deriveMyGrowthGoals(): number {
  const path = join(workspaceDir, "My-Growth/brag-doc.md");
  if (!existsSync(path)) return 0;
  const text = readText(path);
  return countBulletsUnderSections(text, new Set(["Growth goals", "Development plan"]));
}

function deriveRiskLinkedNotes(): number {
  const path = join(workspaceDir, "Risks/risk-register.md");
  if (!existsSync(path)) return 0;
  const text = readText(path);
  return [...text.matchAll(/\*\*\d{4}-\d{2}-\d{2}\*\*/g)].length;
}

function deriveAccomplishments(): number {
  const path = join(workspaceDir, "My-Growth/brag-doc.md");
  if (!existsSync(path)) return 0;
  const lines = readText(path).split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    if (/^\s*-\s+\d{4}-\d{2}-\d{2}\s*[—-]\s+/.test(line)) count++;
  }
  return count;
}

function deriveReferences(): number {
  return (
    countFilesInDir(join(workspaceDir, "Systems")) +
    (existsSync(join(workspaceDir, "Acronyms.md")) ? 1 : 0)
  );
}

function deriveGeneratedSkips(): number {
  const path = join(workspaceDir, "TODO.md");
  if (!existsSync(path)) return 0;
  let count = 0;
  for (const line of readText(path).split(/\r?\n/)) {
    if (/^-\s*\[(x| )\]\s*(.*)$/.test(line)) count++;
  }
  return count;
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
  const explicitOther =
    /\[\[People\/[^\]|]+\|[^\]]+\]\]\s*:/.test(beforeTags) ||
    /(?<![A-Za-z0-9])(Alex|Sam|Zoë|Zoe|Jordan|Priya)\s*:/.test(beforeTags);
  // Other-owned items in the self file (Todos.md) are owed to the user.
  if (explicitOther) return fileRel === "Todos.md";
  if (/\bme\s*:/.test(beforeTags)) return true;
  if (/\bthem\s*:/.test(beforeTags)) return fileRel === "Todos.md";
  // Waiting/blocked markers are owed to the user even when the owner syntax is bare.
  if (/!(blocked|waiting-)/.test(line)) return true;
  // Bare (absent) owners resolve to self only in the self file; in files about others they
  // stay with the file's subject and are reported as skipped_not_mine.
  return fileRel === "Todos.md";
}

function hasActivationTag(line: string): boolean {
  // Match tag syntax: a `!` token preceded by start/whitespace and followed by whitespace,
  // end-of-line, or another tag. Do not match bare substrings like "now" in prose.
  return /(^|\s)!(?:\d{4}-\d{2}-\d{2}|p[0-3]|now|next|soon|later|someday|blocked|waiting-[^\s#]+)(?=\s|$|#)/.test(
    line,
  );
}

function deriveCommitments(
  files: string[],
  mtimes: Record<string, string>,
): {
  proposed: number;
  archived: number;
  done: number;
  skippedNotMine: number;
  unparseable: number;
  generatedSkips: number;
} {
  const result = {
    proposed: 0,
    archived: 0,
    done: 0,
    skippedNotMine: 0,
    unparseable: 0,
    generatedSkips: 0,
  };
  for (const file of files) {
    const rel = relative(workspaceDir, file).split("\\").join("/");
    const lines = readText(file).split(/\r?\n/);
    if (rel === "TODO.md") {
      for (const line of lines) {
        if (/^-\s*\[(x| )\]\s*(.*)$/.test(line)) result.generatedSkips++;
      }
      continue;
    }
    const recent = isFileRecent(rel, mtimes);
    for (const line of lines) {
      const checkbox = line.match(/^-\s*\[(x| )\]\s*(.*)$/);
      if (!checkbox) continue;
      const [, check, rest] = checkbox;
      if (check === undefined || rest === undefined) continue;
      const checked = check === "x";
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
        result.proposed++;
      } else if (userOwned) {
        result.archived++;
      } else {
        result.skippedNotMine++;
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
      "!waiting-Jordan",
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

    expect(derivePersonNotes()).toBe(expected.get("person_notes"));
    expect(derivePeopleGrowthGoals()).toBe(expected.get("growth_goals (People)"));
    expect(deriveMyGrowthGoals()).toBe(expected.get("growth_goals (My-Growth)"));
    expect(deriveMeetings(workspaceFiles)).toBe(expected.get("meetings"));
    expect(deriveSourceItems(workspaceFiles)).toBe(expected.get("source_items"));
    expect(deriveGoals()).toBe(expected.get("goals"));
    expect(deriveDecisions()).toBe(expected.get("decisions"));
    expect(deriveRisks()).toBe(expected.get("risks"));
    expect(deriveRiskLinkedNotes()).toBe(expected.get("risk_linked_notes"));
    expect(deriveDocuments()).toBe(expected.get("documents"));
    expect(deriveDrafts()).toBe(expected.get("drafts"));
    expect(deriveAccomplishments()).toBe(expected.get("accomplishments"));
    expect(deriveReferences()).toBe(expected.get("references / glossary"));
    expect(deriveGeneratedSkips()).toBe(expected.get("generated skipped lines"));

    const commitments = deriveCommitments(workspaceFiles, mtimes);
    expect(commitments.proposed).toBe(expected.get("commitments (proposed)"));
    expect(commitments.archived).toBe(expected.get("commitments (archived)"));
    expect(commitments.done).toBe(expected.get("commitments (done)"));
    expect(commitments.skippedNotMine).toBe(expected.get("commitments (skipped_not_mine)"));
    expect(commitments.unparseable).toBe(expected.get("unparseable todo line"));
  });
});
