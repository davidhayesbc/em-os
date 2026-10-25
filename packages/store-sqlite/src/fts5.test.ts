import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("SQLite FTS5 availability", () => {
  it("creates an FTS5 table and finds inserted text with MATCH", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE VIRTUAL TABLE docs USING fts5(body)");
      db.prepare("INSERT INTO docs(body) VALUES (?)").run("alpha beta");
      db.prepare("INSERT INTO docs(body) VALUES (?)").run("gamma delta");
      const rows = db.prepare("SELECT body FROM docs WHERE docs MATCH ?").all("beta");
      expect(rows).toEqual([{ body: "alpha beta" }]);
    } finally {
      db.close();
    }
  });
});
