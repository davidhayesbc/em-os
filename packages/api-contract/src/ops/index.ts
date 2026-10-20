import { backupCreate } from "./backup.js";
import { healthGet } from "./health.js";

// Append-only registry, keyed by op name. Other tasks add entries.
export const ops = {
  "health.get": healthGet,
  "backup.create": backupCreate,
} as const;
