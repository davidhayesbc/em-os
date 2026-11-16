import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown, type Section } from "./markdown.js";
import { parseTodoLine } from "./todo-line.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/workspace");

function flattenSections(section: Section): Section[] {
  return [section, ...section.children.flatMap(flattenSections)];
}

describe("parsers tolerate the P1-16 fixture workspace drift", () => {
  it("parses the CRLF Stakeholders file without corrupting sections", () => {
    const text = readFileSync(join(fixtureDir, "Stakeholders/jordan-patel.md"), "utf8");
    const { sections, lineCount } = parseMarkdown(text);
    expect(lineCount).toBeGreaterThan(0);
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain("Basics");
    expect(headings).toContain("Context on them");
    expect(headings).toContain("Six-month rollup");
    expect(headings).toContain("Relationship");
  });

  it("parses every checkbox line across the fixture workspace", () => {
    const files = [
      "Todos.md",
      "1-1s/Alex-Rivera/2026-10-13.md",
      "1-1s/Alex-Rivera/2026-10-20.md",
      "1-1s/Zoe-Quinn/2026-10-15.md",
      "1-1s/Zoe-Quinn/2026-10-22.md",
      "Daily-Logs/2026-10-20.md",
      "Daily-Logs/2026-10-21.md",
      "Daily-Logs/2026-10-22.md",
      "Daily-Logs/Standups/2026-10-19.md",
      "Daily-Logs/Standups/2026-10-20.md",
      "Daily-Logs/Standups/2026-10-20-multifecta.md",
      "Team-Health/october-pulse.md",
      "Weekly-Summaries/2026-W42.md",
      "TODO.md",
    ];
    let checkboxCount = 0;
    for (const file of files) {
      const text = readFileSync(join(fixtureDir, file), "utf8");
      const { sections } = parseMarkdown(text);
      const lines = sections.flatMap(flattenSections).flatMap((s) => s.lines);
      for (const line of lines) {
        if (/^\s*-\s*\[/.test(line)) {
          checkboxCount++;
          const parsed = parseTodoLine(line, 1);
          expect(parsed).not.toBeNull();
        }
      }
    }
    expect(checkboxCount).toBe(38);
  });

  it("parses date-first owner lines in Todos.md", () => {
    const text = readFileSync(join(fixtureDir, "Todos.md"), "utf8");
    const { sections } = parseMarkdown(text);
    const lines = sections.flatMap(flattenSections).flatMap((s) => s.lines);

    const sam = lines.find((l) => l.includes("Sam: schedule retro"));
    expect(parseTodoLine(sam ?? "", 1)?.owners).toEqual(["Sam"]);
    expect(parseTodoLine(sam ?? "", 1)?.text).toBe("schedule retro");
    expect(parseTodoLine(sam ?? "", 1)?.priority).toBe(0);

    const alexWiki = lines.find((l) => l.includes("Alex]]: update API docs"));
    expect(parseTodoLine(alexWiki ?? "", 1)?.owners).toEqual(["Alex Rivera"]);
    expect(parseTodoLine(alexWiki ?? "", 1)?.text).toBe("update API docs");
  });

  it("returns null for plain bullets", () => {
    const files = [
      "1-1s/Alex-Rivera/2026-10-13.md",
      "1-1s/Alex-Rivera/2026-10-20.md",
      "1-1s/Zoe-Quinn/2026-10-15.md",
      "1-1s/Zoe-Quinn/2026-10-22.md",
      "Daily-Logs/2026-10-20.md",
      "Daily-Logs/2026-10-21.md",
      "Daily-Logs/2026-10-22.md",
    ];
    let found = 0;
    for (const file of files) {
      const text = readFileSync(join(fixtureDir, file), "utf8");
      const { sections } = parseMarkdown(text);
      const lines = sections.flatMap(flattenSections).flatMap((s) => s.lines);
      const plain = lines.filter((l) => /^\s*-\s+/.test(l) && !/^\s*-\s*\[/.test(l));
      for (const line of plain) {
        found++;
        expect(parseTodoLine(line, 1)).toBeNull();
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
