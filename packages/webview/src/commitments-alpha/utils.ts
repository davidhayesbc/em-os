import type { CommitmentDue, CommitmentStatus, Direction, DropReason } from "@emos/api-contract";

export const DIRECTION_LABEL: Record<Direction, string> = {
  mine: "I owe",
  owed_to_me: "Owed to me",
};

export const STATUS_LABEL: Record<CommitmentStatus, string> = {
  proposed: "Proposed",
  active: "Active",
  snoozed: "Snoozed",
  done: "Done",
  dropped: "Dropped",
};

export const DROP_REASON_LABEL: Record<DropReason, string> = {
  user: "User dropped",
  stale: "Stale",
  archived_on_import: "Archived on import",
  merged: "Merged into another item",
};

/** Format a due date (with optional time) for display. Returns `"No date"` when null. */
export function formatDue(due: CommitmentDue | null): string {
  if (!due) return "No date";
  if (due.time) return `${due.date} ${due.time} (${due.timeZone})`;
  return `${due.date} (${due.timeZone})`;
}

/** True when a commitment is past its due date, ignoring time-of-day. */
export function isOverdue(due: CommitmentDue | null, now = new Date()): boolean {
  if (!due) return false;
  const parts = due.date.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return false;
  const [y, m, d] = parts as [number, number, number];
  const deadline = new Date(Date.UTC(y, m - 1, d, 23, 59, 59));
  return now.getTime() > deadline.getTime();
}

/** Format an ISO instant as a short local string. */
export function formatInstant(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format an audit diff as a readable string. */
export function formatDiff(diff: Record<string, { from: unknown; to: unknown }>): string {
  return Object.entries(diff)
    .map(([field, change]) => `${field}: ${formatValue(change.from)} → ${formatValue(change.to)}`)
    .join("; ");
}

function formatValue(value: unknown): string {
  if (value === null) return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
