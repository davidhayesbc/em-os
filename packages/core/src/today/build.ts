import type { Commitment, Goal, Meeting, SourceItem, Today } from "@emos/api-contract";
import { buildPrep } from "../meetings/prep.js";
import { freeBlocks, plan, weekLoad } from "../planning/index.js";
import type { SyncState } from "../ports/repos/sync-state.js";
import { type RankedItem, rank, selectTop } from "../ranking/index.js";

export interface BuildTodayInput {
  localDate: string;
  timeZone: string;
  now: Date;
  onboarded: boolean;
  profile: {
    workingHours: { start: string; end: string };
    workWeek: number[];
    rank: import("@emos/api-contract").RankConfig;
    minFocusMinutes: number;
    defaultEffortMinutes: number;
  };
  commitments: Commitment[];
  meetings: Meeting[];
  goals: Goal[];
  sourceItems: SourceItem[];
  syncStates: SyncState[];
  dayPlanIds: string[] | null;
  refresh: boolean;
}

export function buildToday(input: BuildTodayInput): Today {
  const {
    localDate,
    timeZone,
    now,
    onboarded,
    profile,
    commitments,
    meetings,
    goals,
    sourceItems,
    syncStates,
    dayPlanIds,
    refresh,
  } = input;

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

  const effectiveIds =
    dayPlanIds != null && !refresh ? dayPlanIds : selectedTop.map((item) => item.commitmentId);

  const top = effectiveIds.map((id) => {
    const commitment = commitmentsById.get(id);
    if (!commitment) {
      throw new Error(`Day plan references unknown commitment ${id}`);
    }
    const done = commitment.status === "done";
    const item = done ? null : (ranked.find((r) => r.commitmentId === id) ?? null);
    return { item, commitment, done };
  });

  const doneCount = top.filter((t) => t.done).length;

  const blocks = freeBlocks({
    localDate,
    timeZone,
    workingHours: profile.workingHours,
    meetings,
    now,
    minMinutes: profile.minFocusMinutes,
  });

  const dayPlan = plan({
    blocks,
    items: top
      .filter((t) => !t.done)
      .map((t) => t.item)
      .filter((item): item is RankedItem => item != null),
    effortOf: (commitmentId) => {
      const c = commitmentsById.get(commitmentId);
      return c?.effortMinutes ?? profile.defaultEffortMinutes;
    },
  });

  const freeMinutes = blocks.reduce((sum, b) => sum + b.minutes, 0);

  const toTriage = commitments.filter(
    (c) => c.status === "proposed" && c.createdBy !== "import",
  ).length;

  const lastSyncAt = syncStates.reduce<string | null>((latest, s) => {
    if (s.lastSuccessAt == null) return latest;
    return latest == null || s.lastSuccessAt > latest ? s.lastSuccessAt : latest;
  }, null);

  const failingConnectors = syncStates.filter((s) => s.state === "error").map((s) => s.connectorId);

  const timelineMeetings = [...meetings]
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .map((m) => ({
      id: m.id,
      title: m.title,
      start: m.start,
      end: m.end,
      classification: m.classification,
      prepStatus: buildPrep({
        meeting: m,
        person: null,
        commitments,
        previous: null,
        previousNotes: [],
      }).status,
    }));

  const waitingOn = commitments
    .filter((c) => c.direction === "owed_to_me" && c.status === "active")
    .sort((a, b) => {
      const aDue = a.due?.date ?? null;
      const bDue = b.due?.date ?? null;
      if (aDue === bDue) return 0;
      if (aDue == null) return 1;
      if (bDue == null) return -1;
      return aDue < bDue ? -1 : 1;
    });

  return {
    localDate,
    timeZone,
    onboarded,
    header: {
      meetingCount: meetings.length,
      freeMinutes,
      toTriage,
      lastSyncAt,
      failingConnectors,
    },
    weekLoad: weekLoad({
      weekOf: localDate,
      workWeek: profile.workWeek,
      timeZone,
      workingHours: profile.workingHours,
      meetings,
      commitments,
    }),
    timeline: {
      meetings: timelineMeetings,
      plan: dayPlan,
    },
    top,
    waitingOn,
    progress: { done: doneCount, total: top.length },
  };
}
