import type { Accomplishment, IsoDateTime, NewAccomplishment } from "@emos/api-contract";

export interface AccomplishmentsRepo {
  create(a: NewAccomplishment, sourceIds?: string[]): Accomplishment;
  list(f?: { subjectPersonId?: string; from?: IsoDateTime; to?: IsoDateTime }): Accomplishment[];
}
