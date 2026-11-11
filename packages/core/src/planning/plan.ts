import type { RankedItem } from "../ranking/index.js";
import type { Block } from "./free-blocks.js";

export interface DayPlan {
  freeBlocks: Block[];
  placements: { commitmentId: string; blockIndex: number; start: string; end: string }[];
  unplaced: string[];
}

export function plan(i: {
  blocks: Block[];
  items: RankedItem[];
  effortOf: (commitmentId: string) => number;
}): DayPlan {
  const remaining = i.blocks.map((b) => b.minutes);
  const cursors = i.blocks.map((b) => new Date(b.start));
  const placements: DayPlan["placements"] = [];
  const unplaced: string[] = [];

  for (const item of i.items) {
    const effort = i.effortOf(item.commitmentId);
    if (!Number.isFinite(effort) || effort <= 0) {
      unplaced.push(item.commitmentId);
      continue;
    }

    const index = remaining.findIndex((minutes) => minutes >= effort);
    if (index === -1) {
      unplaced.push(item.commitmentId);
      continue;
    }

    const start = cursors[index];
    if (!start) {
      unplaced.push(item.commitmentId);
      continue;
    }
    const end = new Date(start.getTime() + effort * 60000);
    placements.push({
      commitmentId: item.commitmentId,
      blockIndex: index,
      start: start.toISOString(),
      end: end.toISOString(),
    });
    const remainingMinutes = remaining[index];
    if (remainingMinutes == null) {
      unplaced.push(item.commitmentId);
      continue;
    }
    remaining[index] = remainingMinutes - effort;
    cursors[index] = end;
  }

  return { freeBlocks: i.blocks, placements, unplaced };
}
