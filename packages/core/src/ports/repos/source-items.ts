import type { NewSourceItem, SourceItem } from "@emos/api-contract";

export interface SourceItemsRepo {
  upsert(i: NewSourceItem): { item: SourceItem; created: boolean };
  get(id: string): SourceItem | null;
  byIds(ids: string[]): SourceItem[];
}
