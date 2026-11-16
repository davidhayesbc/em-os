import { parseFrontmatter } from "./frontmatter.js";

export interface Section {
  heading: string;
  level: number;
  startLine: number;
  lines: string[];
  children: Section[];
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text;
  const close = text.indexOf("\n---", 4);
  if (close === -1) return text;
  const after = text.indexOf("\n", close + 1);
  if (after === -1) return "";
  return text.slice(after + 1);
}

/**
 * Parse an Obsidian-flavoured Markdown file into a section tree and any
 * leading YAML frontmatter.
 *
 * Line semantics: `startLine` values are 1-based positions in the original
 * (unstripped) file, and `lineCount` is the total number of lines in the
 * original file including frontmatter. Any body text that appears between the
 * frontmatter and the first heading is not represented in the section tree.
 */
export function parseMarkdown(text: string): {
  frontmatter: Record<string, unknown>;
  sections: Section[];
  lineCount: number;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  const frontmatter = parseFrontmatter(normalized);
  const content = stripFrontmatter(normalized);

  const contentLines = content.split("\n");
  const lines = contentLines;
  // Number of lines stripped from the top of the file (frontmatter block).
  const frontmatterLineCount = normalized.split("\n").length - contentLines.length;
  const lineCount = normalized.split("\n").length;

  const root: Section = { heading: "", level: 0, startLine: 1, lines: [], children: [] };
  const stack: Section[] = [root];
  let current = root;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = HEADING_RE.exec(line);
    if (match) {
      const level = match[1]?.length ?? 0;
      const heading = match[2] ?? "";
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1] ?? root;
      const section: Section = {
        heading,
        level,
        startLine: i + frontmatterLineCount + 1,
        lines: [],
        children: [],
      };
      parent.children.push(section);
      stack.push(section);
      current = section;
    } else {
      current.lines.push(line);
    }
  }

  return { frontmatter, sections: root.children, lineCount };
}
