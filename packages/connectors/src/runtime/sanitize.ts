export const LAST_ERROR_MAX_LENGTH = 500;

/**
 * Sanitizes a value written to `sync_state.last_error`:
 * - strips C0/C1 control characters and Unicode format characters (\p{Cc}, \p{Cf}),
 *   which removes ANSI escape sequences and newlines;
 * - truncates on code-point boundaries so surrogate pairs are never split;
 * - coerces non-string inputs to string.
 */
export function sanitizeLastError(value: unknown): string {
  const message = typeof value === "string" ? value : String(value);
  const cleaned = message.replace(/[\p{Cc}\p{Cf}]/gu, "");
  return Array.from(cleaned).slice(0, LAST_ERROR_MAX_LENGTH).join("");
}
