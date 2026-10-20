import { z } from "zod";

export const ErrorCode = z.enum([
  "unauthorized",
  "not_found",
  "invalid_input",
  "conflict",
  "unavailable",
  "incompatible_version",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string = code, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ApiError";
    this.code = code;
  }
}
