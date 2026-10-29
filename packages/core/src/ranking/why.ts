import type { Commitment, Goal, Meeting, RankConfig } from "@emos/api-contract";
import { addLocalDays, startOfLocalDay, toLocalDate } from "../time/zoned.js";

export type ComponentKind =
  | "time_critical"
  | "hard_dated"
  | "waiting_on_me"
  | "goal"
  | "pin"
  | "priority"
  | "urgency";

export interface RankedItem {
  commitmentId: string;
  score: number;
  dominant: ComponentKind;
  why: string;
  components: { kind: ComponentKind; points: number; detail: string }[];
}

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
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(instant);
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

function goalChip(goal: Goal): string {
  const title = goal.title.length > 20 ? `${goal.title.slice(0, 20)}…` : goal.title;
  return `advances ${title}`;
}

export function scoreCommitment(
  c: Commitment,
  ctx: ScoreContext,
): { components: RankedItem["components"]; dominant: RankedItem["components"][number]; why: string } {
  const components: RankedItem["components"] = [];
  const weights = ctx.config.weights;

  // time-critical: linked meeting within the window, or due today/tomorrow/overdue.
  let timeCriticalPoints = 0;
  let timeCriticalDetail = "";

  if (c.meetingId) {
    const meeting = ctx.meetingById.get(c.meetingId);
    if (meeting) {
      const start = new Date(meeting.start).getTime();
      const windowEnd = ctx.now.getTime() + ctx.config.timeCriticalHours * 3600000;
      if (start >= ctx.now.getTime() && start <= windowEnd) {
        timeCriticalPoints = weights.timeCritical;
        timeCriticalDetail = formatMeetingTime(meeting.start, ctx.timeZone);
      }
    }
  }

  if (c.due) {
    const dueDate = c.due.date;
    if (dueDate === ctx.today || dueDate === ctx.tomorrow) {
      timeCriticalPoints = Math.max(timeCriticalPoints, weights.timeCritical);
      if (!timeCriticalDetail) timeCriticalDetail = dueChip(dueDate, ctx.today, ctx.timeZone);
    } else {
      const daysOverdue = localDayDiff(dueDate, ctx.today, ctx.timeZone);
      if (daysOverdue > 0) {
        const points = weights.timeCritical + weights.overduePerDay * daysOverdue;
        if (points > timeCriticalPoints) {
          timeCriticalPoints = points;
          timeCriticalDetail = `overdue ${daysOverdue}d`;
        }
      }
    }
  }

  if (timeCriticalPoints > 0) {
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

  // priority p0..p3.
  if (c.priority != null) {
    const points = weights.priority[c.priority];
    if (points != null && points > 0) {
      components.push({ kind: "priority", points, detail: `p${c.priority}` });
    }
  }

  // urgency now.
  if (c.urgency === "now") {
    components.push({ kind: "urgency", points: weights.urgencyNow, detail: "now" });
  }

  const dominant = components.reduce(
    (best, current) => {
      if (current.points > best.points) return current;
      if (current.points === best.points && KIND_ORDER[current.kind] < KIND_ORDER[best.kind]) {
        return current;
      }
      return best;
    },
    components[0] ?? { kind: "pin" as ComponentKind, points: 0, detail: "" },
  );

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
    meetingById: new Map(meetings.map((m) => [m.id, m])),
    goalById: new Map(goals.map((g) => [g.id, g])),
  };
}
