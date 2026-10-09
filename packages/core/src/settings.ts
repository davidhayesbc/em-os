import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AppSettings } from "./contracts";

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  schemaVersion: 1,
  staleCiHours: 24,
  staleDataHours: 6,
});

export function appDataDirectory(platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.EM_OS_DATA_DIR) return resolve(env.EM_OS_DATA_DIR);
  if (platform === "darwin") return join(home, "Library", "Application Support", "em-os");
  if (platform === "win32") return join(env.APPDATA ?? join(home, "AppData", "Roaming"), "em-os");
  return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "em-os");
}

export function localPaths(dataDirectory = appDataDirectory()) {
  return {
    dataDirectory,
    database: join(dataDirectory, "em-os.sqlite3"),
    settings: join(dataDirectory, "settings.json"),
  } as const;
}
