import { describe, expect, it } from "vitest";
import { parseTodoLine } from "./todo-line.js";

describe("parseTodoLine", () => {
  it("returns null for a plain bullet", () => {
    expect(parseTodoLine("- a plain bullet", 1)).toBeNull();
  });

  it("parses the flagship example", () => {
    const line =
      "- [ ] 2026-09-22 — ([[People/Jane-Doe|Jane]] + Morgan) **Share test matrix** !next #ws:proj-x #risk-R8 <!-- id:teamv2readpaths --> <!-- id:a1b2c3 -->";
    const todo = parseTodoLine(line, 3);
    expect(todo).not.toBeNull();
    expect(todo?.done).toBe(false);
    expect(todo?.date).toBe("2026-09-22");
    expect(todo?.owners).toEqual(["Jane Doe", "Morgan"]);
    expect(todo?.text).toBe("Share test matrix");
    expect(todo?.urgency).toBe("next");
    expect(todo?.workstream).toBe("proj-x");
    expect(todo?.tags).toEqual(["risk-R8"]);
    expect(todo?.ids).toEqual(["a1b2c3", "teamv2readpaths"]);
  });

  it("parses !waiting-jordan", () => {
    const todo = parseTodoLine(
      "- [ ] 2026-10-24 — me: close the loop !waiting-Jordan #tag:hiring <!-- id:d4e5f7 -->",
      2,
    );
    expect(todo?.waitingOn).toBe("jordan");
  });

  it("parses !YYYY-MM-DD as a due date", () => {
    const todo = parseTodoLine(
      "- [ ] 2026-10-25 — me: prepare weekly summary !p1 !2026-10-25 #tag:imported <!-- id:a1b2c3 -->",
      2,
    );
    expect(todo?.priority).toBe(1);
    expect(todo?.due).toBe("2026-10-25");
    expect(todo?.tags).toEqual(["imported"]);
  });

  it("parses priority, urgency, blocked, workstream and supersedes tags", () => {
    const todo = parseTodoLine(
      "- [ ] 2026-10-26 — me: finalize onboarding !p1 !blocked #ws:api-cleanup #supersedes:c3d4e5 <!-- id:e5f6a2 -->",
      2,
    );
    expect(todo?.priority).toBe(1);
    expect(todo?.blocked).toBe(true);
    expect(todo?.workstream).toBe("api-cleanup");
    expect(todo?.supersedes).toEqual(["c3d4e5"]);
  });

  it("parses owner-first and checked lines", () => {
    const todo = parseTodoLine(
      "- [x] Alex: 2026-10-28 — confirm scope !p1 #tag:planning <!-- id:b2c3d6 -->",
      2,
    );
    expect(todo?.done).toBe(true);
    expect(todo?.owners).toEqual(["Alex"]);
    expect(todo?.date).toBe("2026-10-28");
    expect(todo?.text).toBe("confirm scope");
  });

  it("returns a TodoLine for unparseable checkbox lines instead of null", () => {
    const todo = parseTodoLine("- [ ] not a valid todo line", 5);
    expect(todo).not.toBeNull();
    expect(todo?.text).toBe("not a valid todo line");
    expect(todo?.ids).toEqual([]);
  });
});
