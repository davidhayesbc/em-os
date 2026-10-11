import assert from "node:assert/strict";
import test from "node:test";
import { appDataDirectory, localPaths } from "./settings";

test("uses platform app-data directories outside a checkout", () => {
  assert.equal(appDataDirectory("darwin", {}, "/Users/test"), "/Users/test/Library/Application Support/EM OS");
  assert.equal(appDataDirectory("win32", { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, "C:\\Users\\test"), "C:\\Users\\test\\AppData\\Local\\EM OS");
  assert.equal(appDataDirectory("linux", { XDG_DATA_HOME: "/var/user-data" }, "/home/test"), "/var/user-data/em-os");
  const paths = localPaths("/safe/em-os");
  assert.match(paths.database, /[\\/]safe[\\/]em-os[\\/]db[\\/]em-os\.sqlite3$/);
  assert.match(paths.settings, /[\\/]safe[\\/]em-os[\\/]settings\.json$/);
  assert.match(paths.backupsDir, /[\\/]safe[\\/]em-os[\\/]backups$/);
  assert.match(paths.cacheDir, /[\\/]safe[\\/]em-os[\\/]cache$/);
  assert.match(paths.logsDir, /[\\/]safe[\\/]em-os[\\/]logs$/);
});

test("explicit data-directory override wins and preserves subdirectories", () => {
  assert.equal(appDataDirectory("darwin", { EM_OS_DATA_DIR: "/controlled/em-os" }, "/Users/test"), "/controlled/em-os");
  assert.equal(appDataDirectory("win32", { EM_OS_DATA_DIR: "C:\\controlled\\em-os" }, "C:\\Users\\test"), "C:\\controlled\\em-os");
  assert.equal(localPaths("/controlled/em-os").database, "/controlled/em-os/db/em-os.sqlite3");
});
