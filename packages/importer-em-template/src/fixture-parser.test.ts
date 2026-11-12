import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown.js";
import { parseTodoLine } from "./todo-line.js";

const fixtureDir = join(import.meta.dirname, "../fixtures/workspace");

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

  it("parses every checkbox line in Todos.md", () => {
    const text = readFileSync(join(fixtureDir, "Todos.md"), "utf8");
    const { sections } = parseMarkdown(text);
    const todos = sections.flatMap((s) => [s, ...s.children]).flatMap((s) => s.lines);
    let checkboxCount = 0;
    for (const line of todos) {
      if (/^\s*-\s*\[/.test(line)) {
        checkboxCount++;
        const parsed = parseTodoLine(line, 1);
        expect(parsed).not.toBeNull();
      }
    }
    expect(checkboxCount).toBeGreaterThanOrEqual(10);
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
    for (const file of files) {
      const text = readFileSync(join(fixtureDir, file), "utf8");
      const { sections } = parseMarkdown(text);
      const lines = sections.flatMap((s) => [s, ...s.children]).flatMap((s) => s.lines);
      const plain = lines.find((l) => /^\s*-\s+/.test(l) && !/^\s*-\s*\[/.test(l));
      if (plain) {
        expect(parseTodoLine(plain, 1)).toBeNull();
        return;
      }
    }
    throw new Error("no plain bullet found in fixture workspace");
  });
});
