import { ApiError, type Commitment } from "@emos/api-contract";
import type { CommitmentAction } from "../ports/repos/commitments.js";

const allowed: Record<Commitment["status"], readonly CommitmentAction[]> = {
  proposed: ["activate", "drop"],
  active: ["complete", "snooze", "drop", "edit", "pin", "unpin"],
  snoozed: ["activate", "complete", "drop", "edit"],
  done: ["reopen"],
  dropped: ["reopen"],
};

export function transition(
  c: Commitment,
  action: CommitmentAction,
  at: Date,
  args: { until?: string; reason?: Commitment["dropReason"] } = {},
): Commitment {
  if (!allowed[c.status].includes(action)) {
    throw new ApiError("conflict", `Cannot ${action} a ${c.status} commitment`);
  }
  const instant = at.toISOString();
  const next: Commitment = { ...c, updatedAt: instant };
  switch (action) {
    case "activate":
    case "reopen":
      return { ...next, status: "active", dropReason: null, completedAt: null, snoozedUntil: null };
    case "complete":
      return { ...next, status: "done", completedAt: instant, snoozedUntil: null };
    case "snooze":
      if (!args.until) throw new ApiError("invalid_input", "until is required");
      return { ...next, status: "snoozed", snoozedUntil: args.until };
    case "drop":
      if (!args.reason) throw new ApiError("invalid_input", "reason is required");
      return { ...next, status: "dropped", dropReason: args.reason, snoozedUntil: null };
    case "pin":
      return { ...next, pinned: true };
    case "unpin":
      return { ...next, pinned: false };
    case "edit":
      return next;
  }
}
