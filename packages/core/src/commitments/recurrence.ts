import type { LocalDate, Recurrence } from "@emos/api-contract";

const parse = (date: LocalDate): Date => new Date(`${date}T00:00:00.000Z`);
const format = (date: Date): LocalDate => date.toISOString().slice(0, 10) as LocalDate;

export function nextOccurrence(r: Recurrence, after: LocalDate): LocalDate {
  const date = parse(after);
  if (r.freq === "daily") {
    date.setUTCDate(date.getUTCDate() + r.interval);
    return format(date);
  }
  if (r.freq === "weekly") {
    const weekdays = [...(r.byWeekday ?? [date.getUTCDay()])].sort((a, b) => a - b);
    for (let days = 1; days <= r.interval * 7; days++) {
      const candidate = new Date(date);
      candidate.setUTCDate(candidate.getUTCDate() + days);
      if (weekdays.includes(candidate.getUTCDay())) return format(candidate);
    }
  }
  const day = r.byMonthDay ?? date.getUTCDate();
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + r.interval, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return format(first);
}
