import type { Direction, LocalDate, Recurrence, Urgency } from "@emos/api-contract";
import { addLocalDays, toLocalDate } from "../time/zoned.js";

export interface ParsedCapture {
  title: string;
  direction: Direction;
  personQuery: string | null;
  due: { date: LocalDate; time: null; timeZone: string } | null;
  priority: 0 | 1 | 2 | 3 | null;
  urgency: Urgency | null;
  tags: string[];
  recurrence: Recurrence | null;
}

const weekdays: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const urgencies = new Set<Urgency>(["now", "next", "soon", "later", "someday"]);

function weekday(date: LocalDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function nextWeekday(today: LocalDate, target: number): LocalDate {
  return addLocalDays(today, (target - weekday(today) + 7) % 7) as LocalDate;
}

function isLocalDate(value: string): value is LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return addLocalDays(value, 0) === value;
  } catch {
    return false;
  }
}

export function parseQuickCapture(
  text: string,
  now: Date,
  timeZone: string,
): ParsedCapture | { error: "empty_title" | "invalid_due_date" } {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const today = toLocalDate(now, timeZone) as LocalDate;
  let direction: Direction = "mine";
  let personQuery: string | null = null;
  let dueDate: LocalDate | null = null;
  let priority: 0 | 1 | 2 | 3 | null = null;
  let urgency: Urgency | null = null;
  let recurrence: Recurrence | null = null;
  const tags: string[] = [];
  const title: string[] = [];

  if (tokens[0]?.toLowerCase() === "wait") {
    direction = "owed_to_me";
    tokens.shift();
  }

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith("@") && lower.length > 1) {
      personQuery ??= token.slice(1);
      continue;
    }
    const priorityMatch = /^!p([0-3])$/.exec(lower);
    if (priorityMatch) {
      priority = Number(priorityMatch[1]) as 0 | 1 | 2 | 3;
      continue;
    }
    const urgencyValue = lower.startsWith("!") ? lower.slice(1) : "";
    if (urgencies.has(urgencyValue as Urgency)) {
      urgency = urgencyValue as Urgency;
      continue;
    }
    if (lower === "!today") {
      dueDate = today;
      continue;
    }
    if (lower === "!tomorrow") {
      dueDate = addLocalDays(today, 1) as LocalDate;
      continue;
    }
    const weekdayMatch = /^!(sun|mon|tue|wed|thu|fri|sat)$/.exec(lower);
    if (weekdayMatch) {
      const target = weekdays[weekdayMatch[1] ?? ""];
      if (target === undefined) throw new Error("Unreachable weekday token");
      dueDate = nextWeekday(today, target);
      continue;
    }
    const fixedDate = lower.startsWith("!") ? lower.slice(1) : "";
    if (isLocalDate(fixedDate)) {
      dueDate = fixedDate;
      continue;
    }
    const relativeMatch = /^!\+(\d+)d$/.exec(lower);
    if (relativeMatch) {
      try {
        const relativeDate = addLocalDays(today, Number(relativeMatch[1]));
        if (!isLocalDate(relativeDate)) return { error: "invalid_due_date" };
        dueDate = relativeDate;
      } catch {
        return { error: "invalid_due_date" };
      }
      continue;
    }
    if (lower === "!every-day") {
      recurrence = { freq: "daily", interval: 1, byWeekday: null, byMonthDay: null };
      dueDate ??= today;
      continue;
    }
    const weeklyMatch = /^!every-(sun|mon|tue|wed|thu|fri|sat)$/.exec(lower);
    if (weeklyMatch) {
      const target = weekdays[weeklyMatch[1] ?? ""];
      if (target === undefined) throw new Error("Unreachable weekly token");
      recurrence = { freq: "weekly", interval: 1, byWeekday: [target], byMonthDay: null };
      dueDate ??= nextWeekday(today, target);
      continue;
    }
    if (lower === "!every-month") {
      recurrence = {
        freq: "monthly",
        interval: 1,
        byWeekday: null,
        byMonthDay: null,
      };
      continue;
    }
    if (token.startsWith("#") && token.length > 1) {
      tags.push(token.slice(1));
      continue;
    }
    title.push(token);
  }

  const normalizedTitle = title.join(" ").trim();
  if (!normalizedTitle) return { error: "empty_title" };
  if (recurrence?.freq === "monthly") {
    dueDate ??= today;
    recurrence = { ...recurrence, byMonthDay: Number(dueDate.slice(8, 10)) };
  }
  return {
    title: normalizedTitle,
    direction,
    personQuery,
    due: dueDate ? { date: dueDate, time: null, timeZone } : null,
    priority,
    urgency,
    tags,
    recurrence,
  };
}
