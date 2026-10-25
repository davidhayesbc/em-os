import type { Commitment } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { transition } from "./transitions.js";

const base = (status: Commitment["status"] = "active"): Commitment => ({
  id: "cmt_test",
  direction: "mine",
  status,
  dropReason: status === "dropped" ? "user" : null,
  urgency: null,
  priority: null,
  due: null,
  tags: [],
  createdBy: "user",
  ownerId: "per_owner",
  counterpartId: null,
  goalId: null,
  meetingId: null,
  title: "Send the update",
  notes: "",
  pinned: false,
  effortMinutes: null,
  snoozedUntil: null,
  completedAt: null,
  recurrence: null,
  seriesId: null,
  occurredAt: "2026-10-20T16:00:00.000Z",
  capturedAt: "2026-10-20T16:00:00.000Z",
  updatedAt: "2026-10-20T16:00:00.000Z",
  retentionState: "active",
});

const at = new Date("2026-10-24T12:00:00.000Z");

describe("commitment transitions", () => {
  it("complete sets completedAt and done", () => {
    expect(transition(base(), "complete", at)).toMatchObject({
      status: "done",
      completedAt: "2026-10-24T12:00:00.000Z",
      updatedAt: "2026-10-24T12:00:00.000Z",
    });
  });

  it("complete on a dropped commitment conflicts", () => {
    expect(() => transition(base("dropped"), "complete", at)).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
  });

  it("edit is allowed while snoozed", () => {
    expect(transition(base("snoozed"), "edit", at).status).toBe("snoozed");
  });
});
