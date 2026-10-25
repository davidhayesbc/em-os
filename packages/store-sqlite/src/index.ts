// @emos/store-sqlite: the SQLite implementation of the @emos/core Store port.
// Rules for repos (Phase 1 slices):
// * store every instant via toDbInstant() (canonical `YYYY-MM-DDTHH:MM:SS.sssZ`; the schema's
//   CHECKs reject anything else);
// * schema changes are new migrations (see migrations/index.ts), never edits to applied ones.
// biome-ignore assist/source/organizeImports: this public export registry is append-only.
export type { Db, Statement } from "./driver.js";
export { type Migration, migrate, pendingMigrations } from "./migrate.js";
export { migrations } from "./migrations/index.js";
export { type OpenDbOptions, openDb } from "./open.js";
export { assertNotInGitCheckout, type DataLayout, dataLayout, resolveDataDir } from "./paths.js";
export { createAccomplishmentsRepo } from "./repos/accomplishments.js";
export { createCommitmentsRepo } from "./repos/commitments.js";
export { createGoalsRepo } from "./repos/goals.js";
export { createStore } from "./store.js";
export { toDbInstant } from "./time.js";
export { createSettingsRepo } from "./repos/settings.js";
export { createPeopleRepo } from "./repos/people.js";
