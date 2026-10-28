import { type Commitment, Commitment as CommitmentSchema } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { transition } from "./transitions.js";

type Assessment = "supported" | "unsupported" | "requires product decision";

const NOW = new Date("2026-10-25T09:00:00.000Z");

function commitment(overrides: Partial<Commitment> = {}): Commitment {
  return CommitmentSchema.parse({
    id: "cmt_synthetic",
    direction: "mine",
    status: "active",
    dropReason: null,
    urgency: null,
    priority: null,
    due: null,
    tags: [],
    createdBy: "user",
    ownerId: "per_alex",
    counterpartId: "per_sam",
    goalId: null,
    meetingId: null,
    title: "Send Sam the synthetic launch summary",
    notes: "",
    pinned: false,
    effortMinutes: null,
    snoozedUntil: null,
    completedAt: null,
    recurrence: null,
    seriesId: null,
    occurredAt: "2026-10-24T16:00:00.000Z",
    capturedAt: "2026-10-24T16:00:00.000Z",
    updatedAt: "2026-10-24T16:00:00.000Z",
    retentionState: "active",
    ...overrides,
  });
}

const assessments = {
  "promise vs intention": "requires product decision",
  "undated promise": "supported",
  "repeat reminder without duplication": "unsupported",
  "incomplete delivery": "requires product decision",
  "deadline renegotiation with original promise retained": "supported",
  "trigger-based obligation": "unsupported",
  "a completed commitment resurfacing in sync": "supported",
} as const satisfies Record<string, Assessment>;

describe("follow-up semantics scenario inventory", () => {
  it("records an explicit assessment for every synthetic scenario", () => {
    expect(Object.entries(assessments)).toEqual([
      ["promise vs intention", "requires product decision"],
      ["undated promise", "supported"],
      ["repeat reminder without duplication", "unsupported"],
      ["incomplete delivery", "requires product decision"],
      ["deadline renegotiation with original promise retained", "supported"],
      ["trigger-based obligation", "unsupported"],
      ["a completed commitment resurfacing in sync", "supported"],
    ]);
  });

  it("promise vs intention — stores the statement but has no speech-act field", () => {
    const promise = commitment({ title: "I will send Sam the launch summary" });
    const intention = commitment({ title: "I plan to send Sam the launch summary" });

    expect(promise.status).toBe("active");
    expect(intention.status).toBe("active");
    expect(Object.keys(promise)).not.toContain("speechAct");
    expect(assessments["promise vs intention"]).toBe("requires product decision");
  });

  it("undated promise — keeps an active commitment with no due date", () => {
    const promise = commitment({ title: "I will send Sam the launch summary", due: null });

    expect(promise).toMatchObject({ status: "active", due: null });
    expect(assessments["undated promise"]).toBe("supported");
  });

  it("repeat reminder without duplication — has no reminder identity or deduplication key", () => {
    const promise = commitment();

    for (const key of ["reminderId", "interactionId", "deduplicationKey"]) {
      expect(Object.keys(promise)).not.toContain(key);
    }
    expect(assessments["repeat reminder without duplication"]).toBe("unsupported");
  });

  it("incomplete delivery — can stay active but cannot record structured partial fulfilment", () => {
    const promise = transition(commitment(), "edit", NOW);

    expect(promise.status).toBe("active");
    for (const key of ["fulfilledAmount", "remainingAmount", "partialCompletions"]) {
      expect(Object.keys(promise)).not.toContain(key);
    }
    expect(assessments["incomplete delivery"]).toBe("requires product decision");
  });

  it("deadline renegotiation with original promise retained — edits due without changing identity", () => {
    const original = commitment({
      due: { date: "2026-10-27", time: null, timeZone: "UTC" },
    });
    const renegotiated = transition(
      {
        ...original,
        due: { date: "2026-10-30", time: null, timeZone: "UTC" },
      },
      "edit",
      NOW,
    );

    expect(renegotiated).toMatchObject({
      id: original.id,
      title: original.title,
      due: { date: "2026-10-30" },
      updatedAt: NOW.toISOString(),
    });
    expect(original.due?.date).toBe("2026-10-27");
    expect(assessments["deadline renegotiation with original promise retained"]).toBe("supported");
  });

  it("trigger-based obligation — has no structured trigger representation", () => {
    const obligation = commitment({
      title: "Send Sam the summary when the synthetic launch is approved",
      due: null,
    });

    expect(obligation.due).toBeNull();
    for (const key of ["trigger", "triggeredAt"]) {
      expect(Object.keys(obligation)).not.toContain(key);
    }
    expect(assessments["trigger-based obligation"]).toBe("unsupported");
  });

  it("a completed commitment resurfacing in sync — remains terminal until explicit reopen", () => {
    const completed = commitment({
      status: "done",
      completedAt: "2026-10-24T18:00:00.000Z",
    });

    expect(() => transition(completed, "edit", NOW)).toThrowError(
      expect.objectContaining({ code: "conflict" }),
    );
    expect(transition(completed, "reopen", NOW)).toMatchObject({
      status: "active",
      completedAt: null,
    });
    expect(assessments["a completed commitment resurfacing in sync"]).toBe("supported");
  });
});
