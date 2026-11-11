import { type ConnectorErrorKind, isConnectorError } from "./errors.js";

const OFFLINE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ETIMEDOUT",
]);

interface ErrnoLike {
  code: string;
  message: string;
}

function isErrnoException(e: unknown): e is ErrnoLike {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code?: unknown }).code === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

/**
 * Classifies a network-level failure.
 * - DNS / TCP / unreachable / undici "fetch failed" → offline
 * - HTTP 429 or 5xx → transient
 * - Anything else → null (caller should decide, e.g. map to schema/config/auth)
 */
export function classifyNetworkError(e: unknown): "offline" | "transient" | null {
  if (isErrnoException(e) && OFFLINE_CODES.has(e.code)) {
    return "offline";
  }
  if (e instanceof Error && e.message === "fetch failed") {
    return "offline";
  }
  if (isErrnoException(e) && e.code === "ECONNRESET") {
    return "transient";
  }
  // HTTP status codes carried by fetch-like errors.
  const status = extractStatus(e);
  if (status !== undefined && (status === 429 || (status >= 500 && status < 600))) {
    return "transient";
  }
  return null;
}

function extractStatus(e: unknown): number | undefined {
  if (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status?: unknown }).status === "number"
  ) {
    return (e as { status: number }).status;
  }
  return undefined;
}

/** Best-effort server/hostname extraction for the offline hint. */
export function extractServerName(e: unknown): string | undefined {
  if (
    typeof e === "object" &&
    e !== null &&
    "hostname" in e &&
    typeof (e as { hostname?: unknown }).hostname === "string"
  ) {
    return (e as { hostname: string }).hostname;
  }
  if (isErrnoException(e)) {
    const m = e.message.match(/(?:https?:\/\/|)([a-zA-Z0-9][\w.-]*\.[a-zA-Z]{2,})/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Converts any runtime error into a connector error kind. Preserves explicit connector errors,
 * classifies network errors, and maps everything unexpected to transient (safe default for a
 * generic runtime).
 */
export function classifyError(e: unknown): ConnectorErrorKind {
  // Prefer the explicit type guard over constructor.name: connector errors are always created by
  // this runtime, so instanceof is reliable; anything else falls through to network/default.
  if (isConnectorError(e)) {
    return e.kind;
  }
  const network = classifyNetworkError(e);
  if (network === "offline") return "offline";
  if (network === "transient") return "transient";
  return "transient";
}
