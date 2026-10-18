const EMAIL_RE = /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Redact secret-like assignments from connector text. Based on the repository-safety
// scanner's assignment-secret pattern, extended with "token", an optional
// identifier prefix, and a prefixed-only `key` branch (bare `key` is not secret).
// - keyword list plus "token" for connector text,
// - bare `key` requires a prefix ending in _, ., / or -,
// - optional single/double/backtick quoting or an unquoted value,
// - value must be 8+ characters,
// - exact, well-defined placeholders are left unchanged.
// The prefix is expressed as a zero-width boundary instead of a consuming optional
// group so the engine never scans ahead for a separator; this keeps matching linear
// on long, separator-dense runs with no keyword.
const SECRET_ASSIGNMENT_RE = /(?:(?:(?<=[_./-])|(?<![A-Za-z0-9./-]))(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token)|(?<=[_./-])key)\b\s*[:=]\s*(?:"([^"\n]{8,})"|'([^'\n]{8,})'|`([^`\n]{8,})`|([^\s,;]{8,}))/gi;
const PLACEHOLDER_RE = /^(?:\[?redacted\]?|example|placeholder|synthetic(?:[-_]test)?|test|dummy|change[-_]?me|x{3,}|your[-_][a-z0-9_-]+|<[^>\r\n]+>|\$\{[^}\r\n]+\}|\.{3})$/i;

/**
 * Redact personal identifiers and secret-like assignments from connector text
 * before it is persisted. Mirrors the repository-safety scanner's email and
 * assignment-secret patterns so that imported excerpts, titles and descriptions
 * never store raw emails or credential-shaped literals.
 */
export function redact(text: string): string {
  if (typeof text !== "string") throw new Error("redact input must be a string");
  // Skip the email regex entirely when there is no '@' in the input.  The email
  // pattern's start is anchored by a zero-width lookbehind boundary so it stays
  // linear and never matches a suffix of a long local part; this guard is a cheap
  // fast path that preserves exact redaction semantics on the common no-email case.
  const withEmailRedacted = text.includes("@")
    ? text.replace(EMAIL_RE, "[REDACTED-EMAIL]")
    : text;
  return withEmailRedacted.replace(SECRET_ASSIGNMENT_RE, (match, ...args) => {
    const secretValue = [args[0], args[1], args[2], args[3]].find((g) => g !== undefined);
    if (!secretValue || PLACEHOLDER_RE.test(secretValue)) return match;
    const index = match.indexOf(secretValue);
    if (index < 0) return match;
    return match.slice(0, index) + "[REDACTED-SECRET]" + match.slice(index + secretValue.length);
  });
}
