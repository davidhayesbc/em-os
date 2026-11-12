import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown.js";

const LF_TEXT = `---\naliases: ["test"]\n---\n
# One\nline a\n\n## Two\nline b\n\n### Three\nline c\n\n## Two again\nline d\n`;

const CRLF_TEXT = LF_TEXT.replace(/\n/g, "\r\n");

describe("parseMarkdown", () => {
  it("normalises CRLF to LF and produces the same sections", () => {
    const lf = parseMarkdown(LF_TEXT);
    const crlf = parseMarkdown(CRLF_TEXT);
    expect(crlf.frontmatter).toEqual(lf.frontmatter);
    expect(crlf.sections).toEqual(lf.sections);
    expect(crlf.lineCount).toBe(lf.lineCount);
  });

  it("builds a nested section tree", () => {
    const { sections } = parseMarkdown(LF_TEXT);
    expect(sections).toHaveLength(1);
    const one = sections[0];
    expect(one?.heading).toBe("One");
    expect(one?.level).toBe(1);
    expect(one?.children).toHaveLength(2);

    const two = one?.children[0];
    expect(two?.heading).toBe("Two");
    expect(two?.level).toBe(2);
    expect(two?.children).toHaveLength(1);

    const three = two?.children[0];
    expect(three?.heading).toBe("Three");
    expect(three?.level).toBe(3);
    expect(three?.lines).toContain("line c");
  });

  it("attaches body lines to the active section", () => {
    const { sections } = parseMarkdown(LF_TEXT);
    expect(sections[0]?.lines).toContain("line a");
  });
});
