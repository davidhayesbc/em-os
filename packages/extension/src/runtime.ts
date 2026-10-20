// Where things are: the data dir, the service's runtime files in `<dataDir>/run/`, and the
// assets/runtime the extension ships with (or, in a development host, the workspace packages).
//
// The data-dir and runtime-file logic is a small, test-pinned duplicate of @emos/store-sqlite's
// `resolveDataDir`/`dataLayout` and @emos/service's `runtimePaths` (see runtime.test.ts), like
// the CLI's env.ts. Importing those packages would bundle node:sqlite (unavailable in VS Code's
// Electron Node) and the native keychain module into the extension host just to join paths.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix, win32 } from "node:path";

/** Contents of `run/service.json` (mirrors `ServiceInfo` in @emos/service). */
export interface ServiceInfo {
  pid: number;
  port: number;
  apiVersion: number;
  serviceVersion: string;
  startedAt: string;
}

/**
 * The per-user data directory: `EMOS_DATA_DIR` wins; else macOS `~/Library/Application
 * Support/EM OS`, Windows `%LOCALAPPDATA%\EM OS`, Linux `${XDG_DATA_HOME:-~/.local/share}/em-os`.
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  homedir: string,
): string {
  const override = env.EMOS_DATA_DIR;
  if (override) return override;
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(homedir, "AppData", "Local");
    return win32.join(local, "EM OS");
  }
  if (platform === "darwin") {
    return posix.join(homedir, "Library", "Application Support", "EM OS");
  }
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && posix.isAbsolute(xdg) ? xdg : posix.join(homedir, ".local", "share");
  return posix.join(base, "em-os");
}

/** Windows-style when it has a drive letter / UNC prefix or any backslash; POSIX otherwise. */
function pathFlavour(dir: string): typeof posix {
  return /^[A-Za-z]:/.test(dir) || dir.includes("\\") ? win32 : posix;
}

/**
 * Throws if `dir` or a parent has a `.git` entry. The service refuses such a data dir too, but
 * its stderr is not captured (it runs detached with no stdio), so checking first gives the user
 * the reason instead of "exited (code 1)".
 */
export function assertNotInGitCheckout(
  dir: string,
  exists: (p: string) => boolean = existsSync,
): void {
  const path = pathFlavour(dir);
  let current = path.resolve(dir);
  for (;;) {
    if (exists(path.join(current, ".git"))) {
      throw new Error(`EM OS data directory is inside a git checkout: ${dir}`);
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function runtimeFiles(dataDir: string): {
  runDir: string;
  serviceJson: string;
  token: string;
  lock: string;
} {
  const runDir = join(dataDir, "run");
  return {
    runDir,
    serviceJson: join(runDir, "service.json"),
    token: join(runDir, "token"),
    lock: join(runDir, "service.lock"),
  };
}

/** `run/service.json`: null when absent, `"invalid"` when unreadable or malformed. */
export function readServiceInfo(dataDir: string): ServiceInfo | null | "invalid" {
  let text: string;
  try {
    text = readFileSync(runtimeFiles(dataDir).serviceJson, "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? null : "invalid";
  }
  try {
    const v = JSON.parse(text) as Partial<ServiceInfo> | null;
    if (
      v &&
      Number.isInteger(v.pid) &&
      Number.isInteger(v.port) &&
      (v.port as number) > 0 &&
      (v.port as number) <= 65535 &&
      typeof v.serviceVersion === "string"
    ) {
      return v as ServiceInfo;
    }
  } catch {
    // fall through
  }
  return "invalid";
}

/** `run/token`, trimmed; null when missing or empty. */
export function readToken(dataDir: string): string | null {
  try {
    return readFileSync(runtimeFiles(dataDir).token, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The pid in `run/service.lock`, or null when absent or unparseable. */
export function readLockPid(dataDir: string): number | null {
  try {
    const t = readFileSync(runtimeFiles(dataDir).lock, "utf8").trim();
    return /^\d+$/.test(t) ? Number(t) : null;
  } catch {
    return null;
  }
}

export function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** `process.kill(pid, 0)`: ESRCH = dead, EPERM = alive but not ours. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `GET /health/ping` answers 200 "ok" (unauthenticated). False on any failure or timeout. */
export async function ping(port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(port)}/health/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200 && (await res.text()) === "ok";
  } catch {
    return false;
  }
}

/** Resolves a workspace package path as seen from the extension's own directory. */
function resolveFromExtension(extensionPath: string, specifier: string): string {
  return createRequire(join(extensionPath, "package.json")).resolve(specifier);
}

/**
 * The webview bundles (`dashboard.js`, `sidebar.js`, `theme.css`): the packaged copy at
 * `<extensionPath>/dist/webview/` (P0-15), else the `@emos/webview` package's `dist/` (dev host).
 */
export function resolveWebviewDist(
  extensionPath: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const packaged = join(extensionPath, "dist", "webview");
  if (exists(join(packaged, "dashboard.js"))) return packaged;
  try {
    const dev = join(
      dirname(resolveFromExtension(extensionPath, "@emos/webview/package.json")),
      "dist",
    );
    if (exists(join(dev, "dashboard.js"))) return dev;
  } catch {
    // not in a workspace checkout
  }
  throw new Error("EM OS webview assets not found (run `npm run build`)");
}

/**
 * The service entry script: `<extensionPath>/dist/service/main.js` when packaged, else
 * `@emos/service/main` resolved from the workspace (dev host).
 */
export function resolveServiceEntry(
  extensionPath: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const packaged = join(extensionPath, "dist", "service", "main.js");
  if (exists(packaged)) return packaged;
  try {
    return resolveFromExtension(extensionPath, "@emos/service/main");
  } catch {
    throw new Error("EM OS service not found (expected dist/service/main.js)");
  }
}
