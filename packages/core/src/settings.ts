import { homedir, platform as processPlatform } from "node:os";
import { posix, win32 } from "node:path";
import type { AppSettings } from "./contracts";

export const DEFAULT_SETTINGS: Readonly<AppSettings> = Object.freeze({
  schemaVersion: 1,
  staleCiHours: 24,
  staleDataHours: 6,
});

export type Platform = "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd" | "posix";

export function appDataDirectory(platform: Platform = processPlatform() as Platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const paths = platform === "win32" ? win32 : posix;
  if (env.EM_OS_DATA_DIR) return paths.resolve(env.EM_OS_DATA_DIR);
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "EM OS");
  if (platform === "win32") return paths.join(env.LOCALAPPDATA ?? paths.join(env.APPDATA ?? paths.join(home, "AppData", "Roaming"), "..", "Local"), "EM OS");
  return paths.join(env.XDG_DATA_HOME ?? paths.join(home, ".local", "share"), "em-os");
}

export interface LocalPaths {
  dataDirectory: string;
  database: string;
  settings: string;
  dbDir: string;
  backupsDir: string;
  cacheDir: string;
  logsDir: string;
}

export function localPaths(dataDirectory = appDataDirectory(), platform: Platform = processPlatform() as Platform): LocalPaths {
  const paths = platform === "win32" ? win32 : posix;
  return {
    dataDirectory,
    dbDir: paths.join(dataDirectory, "db"),
    backupsDir: paths.join(dataDirectory, "backups"),
    cacheDir: paths.join(dataDirectory, "cache"),
    logsDir: paths.join(dataDirectory, "logs"),
    database: paths.join(dataDirectory, "db", "em-os.sqlite3"),
    settings: paths.join(dataDirectory, "settings.json"),
  };
}
