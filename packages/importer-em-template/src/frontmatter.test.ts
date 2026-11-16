import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns empty object when there is no frontmatter", () => {
    expect(parseFrontmatter("# Hello\n")).toEqual({});
  });

  it("parses aliases and scalar fields", () => {
    const text = `---\naliases: ["Jordan P."]\nname: Jordan Patel\n---\n\n## Basics`;
    expect(parseFrontmatter(text)).toEqual({
      aliases: ["Jordan P."],
      name: "Jordan Patel",
    });
  });

  it("tolerates CRLF line endings", () => {
    const text = '---\r\naliases: ["A"]\r\n---\r\n\r\nBody';
    expect(parseFrontmatter(text)).toEqual({ aliases: ["A"] });
  });
});
