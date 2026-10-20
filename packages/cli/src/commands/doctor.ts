import { existsSync, realpathSync, statSync } from "node:fs";
import { API_VERSION, ApiError, createClient, httpTransport } from "@emos/api-contract";
import { assertNotInGitCheckout } from "@emos/store-sqlite";
import { type Command, EXIT_FAILURE, EXIT_OK } from "../command.js";
import {
  baseUrl,
  type CliEnv,
  defaultCliEnv,
  guarded,
  isPidAlive,
  parseFlags,
  ping,
  readServiceInfo,
  readToken,
  resolveDataDirFor,
} from "../env.js";

const USAGE = "Usage: emos doctor [--data-dir <path>]";

/** Passes if it resolves; a rejection's message is the reason shown. */
export type Check = () => Promise<void>;

export interface DoctorDeps {
  cli?: CliEnv;
  /** Is the OS keychain readable? Injected so tests never touch the real one. */
  keychainCheck?: Check;
}

/**
 * Reads `emos/token` from the OS keychain. A missing item is fine ("readable"); only a thrown
 * error (locked, denied, no backend, native module missing) fails. `@emos/service` is imported
 * here, not at the top, because it loads the native keychain module.
 */
export const defaultKeychainCheck: Check = async () => {
  const { createKeychainSecretStore, TOKEN_KEY } = await import("@emos/service");
  await createKeychainSecretStore().get(TOKEN_KEY);
};

function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0] || "failed";
}

type Result = { ok: true; detail?: string } | { ok: false; reason: string };
const pass = (detail?: string): Result => ({ ok: true, ...(detail ? { detail } : {}) });
const fail = (why: string): Result => ({ ok: false, reason: why });

function checkDataDir(dataDir: string): Result {
  try {
    return statSync(dataDir).isDirectory() ? pass(dataDir) : fail(`${dataDir} is not a directory`);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT"
      ? fail(`${dataDir} does not exist`)
      : fail(reason(e));
  }
}

function checkNotInCheckout(dataDir: string): Result {
  let dir = dataDir;
  try {
    dir = realpathSync(dataDir);
  } catch {
    // not created yet: check the path as given
  }
  try {
    assertNotInGitCheckout(dir, existsSync);
    return pass();
  } catch {
    return fail("data dir is inside a git checkout");
  }
}

async function checkReachable(dataDir: string): Promise<Result & { port?: number }> {
  const info = readServiceInfo(dataDir);
  if (info === null) return fail("not running (no run/service.json)");
  if (info === "invalid") return fail("run/service.json is unreadable");
  if (!isPidAlive(info.pid)) {
    return fail(`stale run/service.json (pid ${info.pid} is not running)`);
  }
  if (!(await ping(info.port))) return fail(`no response on port ${info.port}`);
  return { ...pass(), port: info.port };
}

async function checkApiVersion(dataDir: string, port: number | undefined): Promise<Result> {
  if (port === undefined) return fail("service not reachable");
  const token = readToken(dataDir);
  if (token === null) return fail("cannot read run/token");
  try {
    const client = createClient({ transport: httpTransport(baseUrl(port)), token });
    const { apiVersion } = await client.call("health.get", {});
    return apiVersion === API_VERSION
      ? pass()
      : fail(`service speaks ${apiVersion}, this cli expects ${API_VERSION}`);
  } catch (e) {
    return fail(e instanceof ApiError ? e.message : reason(e));
  }
}

async function checkKeychain(check: Check): Promise<Result> {
  try {
    await check();
    return pass();
  } catch (e) {
    return fail(reason(e));
  }
}

function line(label: string, r: Result): string {
  if (r.ok) return `✓ ${label}${r.detail ? ` (${r.detail})` : ""}`;
  return `✗ ${label} — ${r.reason}`;
}

export function createDoctorCommand(deps: DoctorDeps = {}): Command {
  const cli = deps.cli ?? defaultCliEnv();
  const keychainCheck = deps.keychainCheck ?? defaultKeychainCheck;
  return {
    name: "doctor",
    summary: "Check the data dir, service, API version and keychain",
    run: (args, io) =>
      guarded(USAGE, io, async () => {
        const { values } = parseFlags(args, { "data-dir": { type: "string" } }, { min: 0, max: 0 });
        const dataDir = resolveDataDirFor(cli, values["data-dir"]);
        const reachable = await checkReachable(dataDir);
        const results: Array<[string, Result]> = [
          ["data dir", checkDataDir(dataDir)],
          ["not in git checkout", checkNotInCheckout(dataDir)],
          ["service reachable", reachable],
          ["api version", await checkApiVersion(dataDir, reachable.port)],
          ["keychain readable", await checkKeychain(keychainCheck)],
        ];
        for (const [label, r] of results) io.out(`${line(label, r)}\n`);
        return results.every(([, r]) => r.ok) ? EXIT_OK : EXIT_FAILURE;
      }),
  };
}

export const doctorCommand: Command = createDoctorCommand();
