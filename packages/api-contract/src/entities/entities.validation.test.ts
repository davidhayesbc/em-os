import { describe, expect, it } from "vitest";
import { Commitment, Confidence } from "./commitment.js";

describe("Confidence", () => {
  it.each([0, 0.5, 1, "0", "0.5", "1", "  0.75  ", ".25"])("accepts %j", (value) => {
    expect(Confidence.parse(value)).toBe(Number(value));
  });

  it.each([
    undefined,
    null,
    "",
    "   ",
    "0x1",
    "1e-1",
    "not a number",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -0.1,
    1.1,
  ])("normalises %j to null", (value) => {
    expect(Confidence.parse(value)).toBeNull();
  });
});

describe("Commitment confidence field", () => {
  it.each(["", "   ", "0x1"])("normalises invalid string %j to null", (value) => {
    const parsed = Commitment.parse({
      id: "cmt_1",
      direction: "mine",
      status: "active",
      dropReason: null,
      urgency: null,
      priority: null,
      due: null,
      tags: [],
      createdBy: "user",
      ownerId: "per_1",
      counterpartId: null,
      goalId: null,
      meetingId: null,
      title: "T",
      notes: "",
      pinned: false,
      effortMinutes: null,
      snoozedUntil: null,
      completedAt: null,
      recurrence: null,
      seriesId: null,
      confidence: value,
      occurredAt: "2026-10-24T12:00:00.000Z",
      capturedAt: "2026-10-24T12:00:00.000Z",
      updatedAt: "2026-10-24T12:00:00.000Z",
      retentionState: "active",
    });
    expect(parsed.confidence).toBeNull();
  });
});
