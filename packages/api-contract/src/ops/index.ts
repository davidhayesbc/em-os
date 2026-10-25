import { backupCreate } from "./backup.js";
import { healthGet } from "./health.js";
import { serviceShutdown } from "./service.js";
import { layoutGet, layoutSet, settingsGet, settingsUpdate } from "./settings.js";

// Append-only registry, keyed by op name. Other tasks add entries.
export const ops = {
  "health.get": healthGet,
  "backup.create": backupCreate,
  "service.shutdown": serviceShutdown,
  "settings.get": settingsGet,
  "settings.update": settingsUpdate,
  "layout.get": layoutGet,
  "layout.set": layoutSet,
} as const;
