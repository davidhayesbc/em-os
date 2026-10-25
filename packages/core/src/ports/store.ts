/**
 * Persistence port. Synchronous API. Later slices append their repository
 * fields to this interface; keep this file append-only.
 */
import type { SettingsRepo } from "./repos/settings.js";

export interface Store {
  transaction<T>(fn: () => T): T;
  settings: SettingsRepo;
}
