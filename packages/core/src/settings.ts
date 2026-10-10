import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import type { AppSettings } from "./contracts";

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  schemaVersion: 1,
  staleCiHours: 24,
  staleDataHours: 6,
});

export function appDataDirectory(platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const paths = platform === "win32" ? win32 : posix;
  if (env.EM_OS_DATA_DIR) return paths.resolve(env.EM_OS_DATA_DIR);
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "em-os");
  if (platform === "win32") return paths.join(env.APPDATA ?? paths.join(home, "AppData", "Roaming"), "em-os");
  return paths.join(env.XDG_DATA_HOME ?? paths.join(home, ".local", "share"), "em-os");
}

export function localPaths(dataDirectory = appDataDirectory()) {
  const paths = process.platform === "win32" ? win32 : posix;
  return {
    dataDirectory,
    database: paths.join(dataDirectory, "em-os.sqlite3"),
    settings: paths.join(dataDirectory, "settings.json"),
  } as const;
}
