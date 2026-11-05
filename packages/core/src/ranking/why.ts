import type { Commitment, Goal, Meeting, RankConfig } from "@emos/api-contract";
import { addLocalDays, startOfLocalDay, toLocalDate } from "../time/zoned.js";

export type ComponentKind =
  | "time_critical"
  | "hard_dated"
  | "waiting_on_me"
  | "goal"
  | "pin"
  | "priority"
  | "urgency"
  | "neutral";

export interface RankedItem {
  commitmentId: string;
  score: number;
  dominant: ComponentKind;
  why: string;
  components: { kind: ComponentKind; points: number; detail: string }[];
}

/**
 * Security note: `why` may embed `Goal.title`, which can carry `private` sensitivity per
 * ADR 0012. Ranking is local-only and does not redact; any caller that forwards a
 * `RankedItem` over MCP (ADR 0013) or to `plan.narrate` must run egress sensitivity
 * filtering before the chip leaves the trust boundary.
 */

export interface ScoreContext {
  now: Date;
  timeZone: string;
  today: string;
  tomorrow: string;
  config: RankConfig;
  meetingById: Map<string, Meeting>;
  goalById: Map<string, Goal>;
}

const KIND_ORDER: Record<ComponentKind, number> = {
  time_critical: 0,
  hard_dated: 1,
  waiting_on_me: 2,
  goal: 3,
  pin: 4,
  priority: 5,
  urgency: 6,
  neutral: 7,
};

function localDayDiff(a: string, b: string, timeZone: string): number {
  return Math.round(
    (startOfLocalDay(b, timeZone).getTime() - startOfLocalDay(a, timeZone).getTime()) / 86400000,
  );
}

function formatMeetingTime(startIso: string, timeZone: string): string {
  const d = new Date(startIso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  }).formatToParts(d);
  let hour = "";
  let minute = "";
  let dayPeriod = "";
  for (const p of parts) {
    const type = p.type.toLowerCase();
    if (type === "hour") hour = p.value;
    else if (type === "minute") minute = p.value;
    else if (type === "dayperiod") dayPeriod = p.value.toLowerCase();
  }
  if (minute === "00") return `meeting ${hour}${dayPeriod}`;
  return `meeting ${hour}:${minute}${dayPeriod}`;
}

function dueChip(dueDate: string, today: string, timeZone: string): string {
  if (dueDate === today) return "due today";
  const daysPast = localDayDiff(dueDate, today, timeZone); // today - dueDate
  if (daysPast === -1) return "due tomorrow";
  if (daysPast < -1) {
    const daysUntil = -daysPast;
    const instant = startOfLocalDay(dueDate, timeZone);
    if (daysUntil <= 6) {
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
        instant,
      );
      return `due ${weekday}`;
    }
    const monthDay = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
    }).format(instant);
    return `due ${monthDay}`;
  }
  return `overdue ${daysPast}d`;
}

/** C0/C1 control characters that should never reach a display surface or log line. */
function isControlChar(codePoint: number): boolean {
  return (codePoint >= 0x00 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** Sanitise a user-derived title for the "advances …" chip. */
function sanitiseChipText(title: string): string {
  let out = "";
  for (const ch of title) {
    if (!isControlChar(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out;
}

function goalChip(goal: Goal): string {
  const clean = sanitiseChipText(goal.title);
  const graphemes = [...clean];
  const visible = graphemes.slice(0, 20).join("");
  const suffix = graphemes.length > 20 ? "…" : "";
  return `advances ${visible}${suffix}`;
}

export function scoreCommitment(
  c: Commitment,
  ctx: ScoreContext,
): {
  components: RankedItem["components"];
  dominant: RankedItem["components"][number];
  why: string;
} {
  const components: RankedItem["components"] = [];
  const weights = ctx.config.weights;

  // time-critical: linked meeting within the window, or due today/tomorrow/overdue.
  let timeCriticalPoints = 0;
  let timeCriticalDetail = "";
  let timeCriticalApplies = false;

  if (c.meetingId) {
    const meeting = ctx.meetingById.get(c.meetingId);
    if (meeting && meeting.status === "confirmed") {
      const start = new Date(meeting.start).getTime();
      const windowEnd = ctx.now.getTime() + ctx.config.timeCriticalHours * 3600000;
      if (start >= ctx.now.getTime() && start <= windowEnd) {
        timeCriticalPoints = weights.timeCritical;
        timeCriticalDetail = formatMeetingTime(meeting.start, ctx.timeZone);
        timeCriticalApplies = true;
      }
    }
  }

  if (c.due) {
    const dueDate = c.due.date;
    if (dueDate === ctx.today || dueDate === ctx.tomorrow) {
      timeCriticalPoints = Math.max(timeCriticalPoints, weights.timeCritical);
      if (!timeCriticalDetail) timeCriticalDetail = dueChip(dueDate, ctx.today, ctx.timeZone);
      timeCriticalApplies = true;
    } else {
      const daysOverdue = localDayDiff(dueDate, ctx.today, ctx.timeZone);
      if (daysOverdue > 0) {
        const points = weights.timeCritical + weights.overduePerDay * daysOverdue;
        if (points > timeCriticalPoints || !timeCriticalDetail) {
          timeCriticalPoints = Math.max(timeCriticalPoints, points);
          timeCriticalDetail = `overdue ${daysOverdue}d`;
        }
        timeCriticalApplies = true;
      }
    }
  }

  if (timeCriticalApplies) {
    components.push({
      kind: "time_critical",
      points: timeCriticalPoints,
      detail: timeCriticalDetail || "time critical",
    });
  }

  // hard-dated: due later than tomorrow.
  if (c.due) {
    const daysUntil = localDayDiff(ctx.today, c.due.date, ctx.timeZone);
    if (daysUntil >= 2) {
      components.push({
        kind: "hard_dated",
        points: weights.hardDated / daysUntil,
        detail: dueChip(c.due.date, ctx.today, ctx.timeZone),
      });
    }
  }

  // waiting on me: counterpart set, no due date.
  if (c.counterpartId && c.due == null) {
    const ageMs = ctx.now.getTime() - new Date(c.occurredAt).getTime();
    const ageDays = Math.max(0, Math.floor(ageMs / 86400000));
    if (ageDays >= 0) {
      components.push({
        kind: "waiting_on_me",
        points: weights.waitingPerDay * ageDays,
        detail: `waiting on you ${ageDays}d`,
      });
    }
  }

  // goal advancement.
  if (c.goalId) {
    const goal = ctx.goalById.get(c.goalId);
    if (goal?.status === "active") {
      components.push({ kind: "goal", points: weights.goal, detail: goalChip(goal) });
    }
  }

  // manual pin.
  if (c.pinned) {
    components.push({ kind: "pin", points: weights.pin, detail: "pinned" });
  }

  // priority p0..p3 (p3 is intentionally zero points but still an honest component).
  if (c.priority != null) {
    const points = weights.priority[c.priority];
    if (typeof points === "number" && Number.isFinite(points)) {
      components.push({ kind: "priority", points, detail: `p${c.priority}` });
    }
  }

  // urgency now.
  if (c.urgency === "now") {
    components.push({ kind: "urgency", points: weights.urgencyNow, detail: "now" });
  }

  // Neutral is only a fallback: applicable zero-point signals remain genuine.
  const fallback: RankedItem["components"][number] = {
    kind: "neutral",
    points: 0,
    detail: "no additional signal",
  };
  if (components.length === 0) components.push(fallback);

  const dominant = components.reduce((best, current) => {
    if (current.points > best.points) return current;
    if (current.points === best.points && KIND_ORDER[current.kind] < KIND_ORDER[best.kind]) {
      return current;
    }
    return best;
  }, components[0] ?? fallback);

  return { components, dominant, why: dominant.detail };
}

export function buildContext(
  now: Date,
  timeZone: string,
  meetings: Meeting[],
  goals: Goal[],
  config: RankConfig,
): ScoreContext {
  return {
    now,
    timeZone,
    today: toLocalDate(now, timeZone),
    tomorrow: addLocalDays(toLocalDate(now, timeZone), 1),
    config,
    meetingById: new Map(
      meetings
        .filter((m) => m.retentionState === "active" && m.status === "confirmed")
        .map((m) => [m.id, m]),
    ),
    goalById: new Map(goals.filter((g) => g.retentionState === "active").map((g) => [g.id, g])),
  };
}
