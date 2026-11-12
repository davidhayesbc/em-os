export const LAST_ERROR_MAX_LENGTH = 500;

/**
 * Sanitizes a value written to `sync_state.last_error`:
 * - accepts only strings (non-strings are normalized to `null` by the caller);
 * - strips C0/C1 control characters and Unicode format characters (\p{Cc}, \p{Cf}),
 *   which removes ANSI escape sequences and newlines;
 * - truncates on code-point boundaries so surrogate pairs are never split;
 * - returns `null` when the cleaned message is empty, so `state: "error"` is paired with a
 *   visible reason whenever possible.
 */
export function sanitizeLastError(value: string): string {
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, "");
  return Array.from(cleaned).slice(0, LAST_ERROR_MAX_LENGTH).join("");
}

/** Field names that signal a secret value (case-insensitive). */
const SECRET_FIELD_RE = /secret|token|password|api[_-]?key|private/i;

export function isSecretField(key: string): boolean {
  return SECRET_FIELD_RE.test(key);
}

function collectSecretValues(config: unknown): string[] {
  const values: string[] = [];

  function walk(value: unknown, inSecretPath: boolean): void {
    if (typeof value === "string") {
      if (inSecretPath) values.push(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item, inSecretPath);
      return;
    }

    if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        walk(item, inSecretPath || isSecretField(key));
      }
    }
  }

  walk(config, false);
  return values;
}

/**
 * Redacts known secret values from a connector-authored error message before it is persisted.
 *
 * It walks the (already restored) config for fields whose names look like secrets, collects
 * every string value under them, and replaces each exact occurrence in the message with
 * `[redacted]`. It also redacts the JSON-stringified form of each value so that secrets
 * leaked via `JSON.stringify(ctx.config)` are caught even when quotes/backslashes are escaped.
 *
 * Longer values are replaced first so a shorter secret cannot leave a fragment of a longer
 * one behind.
 */
export function redactSecrets(message: string, config: unknown): string {
  const rawValues = [...new Set(collectSecretValues(config))].filter((v) => v.length > 0);
  const targets: string[] = [];

  for (const value of rawValues) {
    targets.push(value);
    const json = JSON.stringify(value);
    if (json !== value) targets.push(json);
  }

  // Longest-first replacement prevents a short value from partially redacting a longer one.
  targets.sort((a, b) => b.length - a.length);

  let redacted = message;
  for (const target of targets) {
    redacted = redacted.replaceAll(target, "[redacted]");
  }

  return redacted;
}
