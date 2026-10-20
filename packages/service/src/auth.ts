// First-party bearer token and request-origin checks (ADR 0001, ADR 0012).
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { SecretStore } from "@emos/core";

/** Keychain key holding the first-party token (one per install). */
export const TOKEN_KEY = "emos/token";

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const POSIX = process.platform !== "win32";

/** 32 random bytes, base64url (43 chars, no padding). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison. Different lengths (and empty strings) never match. */
export function tokensEqual(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function parseBearer(header: string | undefined): string | null {
  const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(header ?? "");
  return m?.[1] ?? null;
}

/**
 * DNS-rebinding protection: a browser tricked into resolving an attacker's name to 127.0.0.1
 * still sends the attacker's name in `Host`. Only `127.0.0.1:<port>` and `localhost:<port>`
 * are accepted.
 */
export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

/**
 * The install's token from the secret store, creating and storing one if it is missing or
 * malformed. Keychain errors propagate: the service doesn't start without its token.
 */
export async function loadOrCreateToken(secrets: SecretStore): Promise<string> {
  const existing = await secrets.get(TOKEN_KEY);
  if (existing !== null && TOKEN_SHAPE.test(existing)) return existing;
  const token = generateToken();
  await secrets.set(TOKEN_KEY, token);
  return token;
}

/**
 * Writes the token file atomically (temp file + rename) with mode 0o600 on POSIX, so readers
 * never see a partial token and a pre-existing looser file can't keep its mode. On Windows the
 * per-user data dir's ACL protects it.
 */
export function writeTokenFile(path: string, token: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, token, { mode: 0o600, flag: "w" });
    if (POSIX) chmodSync(tmp, 0o600); // in case tmp pre-existed with another mode
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}
