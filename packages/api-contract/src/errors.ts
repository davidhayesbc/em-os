// Zod-free on purpose: the webview bundles this through `@emos/api-contract/bridge`.
// The zod enum for schemas is `ErrorCodeSchema` (errors-schema.ts), derived from this tuple.

export const ERROR_CODES = [
  "unauthorized",
  "not_found",
  "invalid_input",
  "conflict",
  "unavailable",
  "incompatible_version",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const CODES: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(x: unknown): x is ErrorCode {
  return typeof x === "string" && CODES.has(x);
}

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = code, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ApiError";
    this.code = code;
  }
}
