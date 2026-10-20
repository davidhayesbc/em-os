import type { Clock } from "./clock.js";

/** Entity id prefixes. An id looks like `cmt_01J...` (prefix, underscore, ULID). */
export const ID_PREFIXES = [
  "per",
  "idn",
  "pnt",
  "gol",
  "cmt",
  "mtg",
  "src",
  "rsk",
  "dec",
  "doc",
  "acc",
  "mcl",
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

export interface IdGen {
  next(prefix: string): string;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10; // 48 bits
const RANDOM_BYTES = 10; // 80 bits -> 16 chars
const MAX_TIME_MS = 2 ** 48 - 1;

function isIdPrefix(prefix: string): prefix is IdPrefix {
  return (ID_PREFIXES as readonly string[]).includes(prefix);
}

function encodeTime(ms: number): string {
  let out = "";
  let rest = ms;
  for (let i = 0; i < TIME_CHARS; i++) {
    out = CROCKFORD.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array): string {
  let value = 0n;
  for (let i = 0; i < RANDOM_BYTES; i++) value = (value << 8n) | BigInt(bytes[i] ?? 0);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out = CROCKFORD.charAt(Number(value & 31n)) + out;
    value >>= 5n;
  }
  return out;
}

/**
 * Time-sortable ids: `${prefix}_` + 26-char Crockford base32 ULID.
 * Pure: the caller injects the entropy source (e.g. `node:crypto.randomBytes`).
 */
export function createUlidIdGen(clock: Clock, randomBytes: (n: number) => Uint8Array): IdGen {
  return {
    next(prefix: string): string {
      if (!isIdPrefix(prefix)) throw new RangeError(`Unknown id prefix: "${prefix}"`);
      const ms = clock.now().getTime();
      if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIME_MS) {
        throw new RangeError(`Clock instant out of ULID range: ${ms}`);
      }
      const bytes = randomBytes(RANDOM_BYTES);
      if (bytes.length < RANDOM_BYTES) {
        throw new RangeError(`randomBytes returned ${bytes.length} bytes, need ${RANDOM_BYTES}`);
      }
      return `${prefix}_${encodeTime(ms)}${encodeRandom(bytes)}`;
    },
  };
}
