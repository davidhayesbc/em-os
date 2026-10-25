import { describe, expect, it } from "vitest";
import { commitmentsQuickCapture } from "./quick-capture.js";

const parsed = {
  title: "Send feedback",
  direction: "mine" as const,
  personQuery: "sam",
  due: { date: "2026-10-23", time: null, timeZone: "America/Los_Angeles" },
  priority: 1 as const,
  urgency: null,
  tags: ["hiring"],
  recurrence: null,
};

describe("commitments.quickCapture contract", () => {
  it("accepts text and an optional explicit counterpart", () => {
    expect(
      commitmentsQuickCapture.input.parse({ text: "Send feedback @sam", counterpartId: "per_sam" }),
    ).toEqual({ text: "Send feedback @sam", counterpartId: "per_sam" });
  });

  it("represents ambiguous and unmatched person resolution", () => {
    expect(
      commitmentsQuickCapture.output.parse({ status: "needs_person", parsed, candidates: [] }),
    ).toEqual({ status: "needs_person", parsed, candidates: [] });
  });

  it("represents invalid input messages", () => {
    expect(commitmentsQuickCapture.output.parse({ status: "invalid", message: "Finish setup first" })).toEqual(
      { status: "invalid", message: "Finish setup first" },
    );
  });
});
