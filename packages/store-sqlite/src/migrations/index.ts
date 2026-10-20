// Ordered migration registry. APPEND-ONLY: a task that changes the schema adds
// `migrations/<task-id>_<area>.sql` (e.g. `p1-41_recurrence.sql`), runs
// `npm run gen:migrations -w @emos/store-sqlite`, and appends one line below.
// Order of application is the order of this array. Never edit or reorder applied entries.
//
// Each migration runs in its own transaction with foreign_keys OFF, and must leave
// PRAGMA foreign_key_check empty. Changing a CHECK (e.g. widening an enum) means a table rebuild;
// follow the recipe in the 0001_initial.sql header exactly:
//   1. for risks/decisions/documents/accomplishments, DROP TRIGGER record_sources_entity_insert
//      and record_sources_entity_update (they name those tables; RENAME fails otherwise);
//   2. CREATE TABLE T_new ...; INSERT INTO T_new SELECT ...; DROP TABLE T;
//      ALTER TABLE T_new RENAME TO T;
//   3. recreate T's indexes and triggers (DROP TABLE removed them), including T_occurred_idx and
//      T_delete_sources;
//   4. recreate the record_sources_entity_* triggers verbatim.
// migrate.test.ts "table rebuild recipe" exercises this on documents.
import { SQL } from "./sql.generated.js";

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  { name: "0001_initial", sql: SQL["0001_initial"] },
];
