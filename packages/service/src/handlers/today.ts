import type { SyncState } from "@emos/core";
import {
  addLocalDays,
  buildToday,
  rank,
  selectTop,
  startOfLocalDay,
  toLocalDate,
} from "@emos/core";
import type { Handler } from "../context.js";

function gatherToday(
  ctx: Parameters<Handler<"today.get">>[0],
  input: { localDate?: string },
  refresh: boolean,
) {
  const profile = ctx.store.settings.getProfile();
  const timeZone = profile.displayTimeZone;
  const now = ctx.clock.now();
  const localDate = input.localDate ?? toLocalDate(now, timeZone);

  const dayStart = startOfLocalDay(localDate, timeZone).toISOString();
  const dayEnd = startOfLocalDay(addLocalDays(localDate, 1), timeZone).toISOString();

  const meetings = ctx.store.meetings.listRange(dayStart, dayEnd);
  const commitments = ctx.store.commitments.list({});
  const goals = ctx.store.goals.list();

  const ticketIds = commitments.map((c) => c.ticketId).filter((id): id is string => id != null);
  const sourceItems = ctx.store.sourceItems.byIds(ticketIds);

  const syncStates: SyncState[] = ctx.registry.map((entry) =>
    ctx.store.syncState.get(entry.def.id),
  );

  let dayPlanIds = ctx.store.dayPlans.get(localDate);
  if (dayPlanIds == null || refresh) {
    const ranked = rank({
      now,
      timeZone,
      commitments,
      meetings,
      goals,
      sourceItems,
      config: profile.rank,
    });
    const commitmentsById = new Map(commitments.map((c) => [c.id, c]));
    const goalsById = new Map(goals.map((g) => [g.id, g]));
    const selectedTop = selectTop(ranked, commitmentsById, goalsById, {
      topN: profile.rank.topN,
      goalSlots: profile.rank.goalSlots,
    });
    dayPlanIds = selectedTop.map((item) => item.commitmentId);
    ctx.store.dayPlans.set(localDate, dayPlanIds);
  }

  const result = buildToday({
    localDate,
    timeZone,
    now,
    onboarded: profile.onboarded,
    profile: {
      workingHours: profile.workingHours,
      workWeek: profile.workWeek,
      rank: profile.rank,
      minFocusMinutes: profile.minFocusMinutes,
      defaultEffortMinutes: profile.defaultEffortMinutes,
    },
    commitments,
    meetings,
    goals,
    sourceItems,
    syncStates,
    dayPlanIds,
    refresh,
  });

  if (!refresh && dayPlanIds != null && dayPlanIds.length !== result.effectiveIds.length) {
    ctx.store.dayPlans.set(localDate, result.effectiveIds);
  }

  return result;
}

export const todayGet: Handler<"today.get"> = (ctx, input) => gatherToday(ctx, input, false);

export const todayRefresh: Handler<"today.refresh"> = (ctx, input) => gatherToday(ctx, input, true);
