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

  it("has daily logs with auto-today and meeting headings", () => {
    let found = false;
    for (const file of workspaceFiles) {
      if (!file.match(/Daily-Logs\/\d{4}-\d{2}-\d{2}\.md$/)) continue;
      const text = readText(file);
      if (
        text.includes("<!-- BEGIN auto-today -->") &&
        text.includes("<!-- END auto-today -->") &&
        /## Meeting — .+ \(\d{4}-\d{2}-\d{2}\)/.test(text)
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
