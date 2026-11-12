import type { DayPlansRepo } from "@emos/core";
import type { Db } from "../driver.js";
import { toDbInstant } from "../time.js";

export function createDayPlansRepo(db: Db): DayPlansRepo {
  const getRow = db.prepare("SELECT commitment_ids FROM day_plans WHERE local_date = ?");
  const upsert = db.prepare(
    `INSERT INTO day_plans (local_date, commitment_ids, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(local_date) DO UPDATE SET
       commitment_ids = excluded.commitment_ids,
       created_at = excluded.created_at`,
  );

  return {
    get(localDate) {
      const row = getRow.get<{ commitment_ids: string }>(localDate);
      if (!row) return null;
      const parsed = JSON.parse(row.commitment_ids);
      if (!Array.isArray(parsed)) return null;
      return parsed as string[];
    },
    set(localDate, ids) {
      const now = new Date();
      upsert.run(localDate, JSON.stringify(ids), toDbInstant(now.toISOString()));
    },
  };
}
