import assert from "node:assert/strict";
import test from "node:test";
import { appDataDirectory, localPaths } from "./settings";

test("uses platform app-data directories outside a checkout", () => {
  assert.equal(appDataDirectory("darwin", {}, "/Users/test"), "/Users/test/Library/Application Support/em-os");
  assert.equal(appDataDirectory("win32", { APPDATA: "C:\\Users\\test\\AppData\\Roaming" }, "C:\\Users\\test"), "C:\\Users\\test\\AppData\\Roaming\\em-os");
  assert.equal(appDataDirectory("linux", { XDG_DATA_HOME: "/var/user-data" }, "/home/test"), "/var/user-data/em-os");
  assert.match(localPaths("/safe/em-os").database, /[\\/]safe[\\/]em-os[\\/]em-os\.sqlite3$/);
});

test("explicit data-directory override wins", () => {
  assert.equal(appDataDirectory("darwin", { EM_OS_DATA_DIR: "/controlled/em-os" }, "/Users/test"), "/controlled/em-os");
  assert.equal(appDataDirectory("win32", { EM_OS_DATA_DIR: "C:\\controlled\\em-os" }, "C:\\Users\\test"), "C:\\controlled\\em-os");
});
