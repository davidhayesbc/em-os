import type { ImportKeysRepo } from "@emos/core";
import type { Db } from "../driver.js";

export function createImportKeysRepo(db: Db): ImportKeysRepo {
  return {
    get(key: string) {
      return (
        db
          .prepare("SELECT entity, entity_id AS entityId FROM import_keys WHERE key = ?")
          .get(key) ?? null
      );
    },
    set(key: string, entity: string, entityId: string) {
      db.prepare("INSERT INTO import_keys (key, entity, entity_id) VALUES (?, ?, ?)").run(
        key,
        entity,
        entityId,
      );
    },
  };
}
