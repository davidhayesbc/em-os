import { backupCreate } from "./backup.js";
import { healthGet } from "./health.js";
import { serviceShutdown } from "./service.js";

// Append-only registry, keyed by op name. Other tasks add entries.
export const ops = {
  "health.get": healthGet,
  "backup.create": backupCreate,
  "service.shutdown": serviceShutdown,
} as const;
