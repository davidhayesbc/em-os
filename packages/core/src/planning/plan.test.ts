import { describe, expect, it } from "vitest";
import type { RankedItem } from "../ranking/index.js";
import { plan } from "./plan.js";

function item(commitmentId: string): RankedItem {
  return {
    commitmentId,
    score: 1,
    dominant: "time_critical",
    why: "due today",
    components: [],
  };
}

describe("plan", () => {
  it("places items greedily into the earliest fitting block", () => {
    const day = plan({
      blocks: [{ start: "2026-10-20T16:00:00.000Z", end: "2026-10-20T17:00:00.000Z", minutes: 60 }],
      items: [item("c1"), item("c2")],
      effortOf: (id) => (id === "c1" ? 30 : 40),
    });

    expect(day.placements).toHaveLength(1);
    expect(day.placements[0]).toEqual({
      commitmentId: "c1",
      blockIndex: 0,
      start: "2026-10-20T16:00:00.000Z",
      end: "2026-10-20T16:30:00.000Z",
    });
    expect(day.unplaced).toEqual(["c2"]);
  });

  it("skips a 75-minute block for a 90-minute item", () => {
    const day = plan({
      blocks: [{ start: "2026-10-20T16:00:00.000Z", end: "2026-10-20T17:15:00.000Z", minutes: 75 }],
      items: [item("c1")],
      effortOf: () => 90,
    });

    expect(day.placements).toHaveLength(0);
    expect(day.unplaced).toEqual(["c1"]);
  });
});
