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

/** Non-terminal statuses that can currently be overdue. */
const OVERDUE_STATUSES: readonly CommitmentStatus[] = ["proposed", "active", "snoozed"];

/** Format a due date (with optional time) for display. Returns `"No date"` when null. */
export function formatDue(due: CommitmentDue | null): string {
  if (!due) return "No date";
  if (due.time) return `${due.date} ${due.time} (${due.timeZone})`;
  return `${due.date} (${due.timeZone})`;
}

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function getParts(d: Date, timeZone: string): DateTimeParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const map = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Convert a date and time expressed in a specific IANA time zone into the
 * corresponding UTC Date. getParts has second granularity, so the deadline
 * should be passed as a full `HH:MM:SS` string.
 */
function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const { hour, minute, second } = parseTime(time);
  const targetMs = Date.UTC(y, m - 1, d, hour, minute, second, 0);

  // Treat the target local components as if they were UTC to get a starting
  // candidate, then adjust until formatting that candidate in the target zone
  // returns the requested local components.
  const candidate = new Date(targetMs);
  for (let i = 0; i < 3; i++) {
    const parts = getParts(candidate, timeZone);
    const actualMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = targetMs - actualMs;
    if (diff === 0) break;
    candidate.setTime(candidate.getTime() + diff);
  }

  return candidate;
}

function parseTime(time: string): { hour: number; minute: number; second: number } {
  const parts = time.split(":");
  const h = parts[0] ?? "0";
  const minute = parts[1] ?? "0";
  const rest = parts[2] ?? "0";
  return { hour: Number(h), minute: Number(minute), second: Number(rest) };
}

/** True when a commitment is past its due date in its stored time zone. */
export function isOverdue(due: CommitmentDue | null, now = new Date()): boolean {
  if (!due) return false;
  const parts = due.date.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return false;

  try {
    if (due.time) {
      const deadline = zonedToUtc(due.date, due.time, due.timeZone);
      return now.getTime() > deadline.getTime();
    }
    const deadline = zonedToUtc(due.date, "23:59:59", due.timeZone);
    // A date-only commitment is overdue once the next day begins in its zone.
    return now.getTime() >= deadline.getTime() + 1000;
  } catch {
    return false;
  }
}

/** True when a commitment's status should currently show an overdue indicator. */
export function isCurrentlyOverdue(
  status: CommitmentStatus,
  due: CommitmentDue | null,
  now = new Date(),
): boolean {
  return OVERDUE_STATUSES.includes(status) && isOverdue(due, now);
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
