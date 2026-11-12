import type { LocalDate } from "@emos/api-contract";

export interface DayPlansRepo {
  get(localDate: LocalDate): string[] | null;
  set(localDate: LocalDate, ids: string[]): void;
}
