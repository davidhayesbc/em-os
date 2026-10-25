import { describe, expect, it } from "vitest";
import { peopleCreate, peopleList, personNotesCreate } from "./people.js";

const person = {
  displayName: "Alex Rivera",
  relationship: "peer" as const,
  pronouns: null,
  aliases: ["Alex"],
  role: "Engineer",
  timeZone: null,
  archived: false,
  oneOnOneCadenceDays: null,
};

describe("people operation inputs", () => {
  it("rejects more relationship filters than the relationship enum contains", () => {
    expect(() =>
      peopleList.input.parse({ relationship: Array.from({ length: 40_000 }, () => "peer") }),
    ).toThrow();
  });

  it("caps aliases and alias lengths", () => {
    expect(() =>
      peopleCreate.input.parse({ ...person, aliases: Array(51).fill("alias") }),
    ).toThrow();
    expect(() => peopleCreate.input.parse({ ...person, aliases: ["a".repeat(201)] })).toThrow();
  });

  it("caps note text, tags and tag lengths", () => {
    const base = { personId: "per_1", text: "Synthetic note" };
    expect(() => personNotesCreate.input.parse({ ...base, text: "n".repeat(100_001) })).toThrow();
    expect(() => personNotesCreate.input.parse({ ...base, tags: Array(51).fill("tag") })).toThrow();
    expect(() => personNotesCreate.input.parse({ ...base, tags: ["t".repeat(101)] })).toThrow();
  });

  it("accepts only bounded HTTP(S) source URLs", () => {
    const base = { personId: "per_1", text: "Synthetic note" };
    expect(() =>
      personNotesCreate.input.parse({ ...base, sourceUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      personNotesCreate.input.parse({
        ...base,
        sourceUrl: `https://example.com/${"a".repeat(2_048)}`,
      }),
    ).toThrow();
    expect(
      personNotesCreate.input.parse({ ...base, sourceUrl: "https://example.com/note" }),
    ).toMatchObject({
      sourceUrl: "https://example.com/note",
    });
  });
});
