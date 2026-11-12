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

export function parseMarkdown(text: string): {
  frontmatter: Record<string, unknown>;
  sections: Section[];
  lineCount: number;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  const frontmatter = parseFrontmatter(normalized);
  const content = stripFrontmatter(normalized);

  const lines = content.split("\n");
  const lineCount = lines.length;

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
        startLine: i + 1,
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
