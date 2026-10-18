const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Redact secret-like assignments from connector text. Based on the repository-safety
// scanner's assignment-secret pattern, extended with "token" and an optional
// identifier prefix (e.g. db_password, github_token, aws_secret_access_key).
// - keyword list plus "token" for connector text,
// - optional single/double/backtick quoting or an unquoted value,
// - value must be 8+ characters,
// - exact, well-defined placeholders are left unchanged.
const SECRET_ASSIGNMENT_RE = /(?<![A-Za-z0-9_.-])(?:[A-Za-z0-9_.-]*[_./-])?(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token|key)\b\s*[:=]\s*(?:"([^"\n]{8,})"|'([^'\n]{8,})'|`([^`\n]{8,})`|([^\s,;]{8,}))/gi;
const PLACEHOLDER_RE = /^(?:\[?redacted\]?|example|placeholder|synthetic(?:[-_]test)?|test|dummy|change[-_]?me|x{3,}|your[-_][a-z0-9_-]+|<[^>\r\n]+>|\$\{[^}\r\n]+\}|\.{3})$/i;

/**
 * Redact personal identifiers and secret-like assignments from connector text
 * before it is persisted. Mirrors the repository-safety scanner's email and
 * assignment-secret patterns so that imported excerpts, titles and descriptions
 * never store raw emails or credential-shaped literals.
 */
export function redact(text: string): string {
  if (typeof text !== "string") throw new Error("redact input must be a string");
  return text
    .replace(EMAIL_RE, "[REDACTED-EMAIL]")
    .replace(SECRET_ASSIGNMENT_RE, (match, ...args) => {
      const secretValue = [args[0], args[1], args[2], args[3]].find((g) => g !== undefined);
      if (!secretValue || PLACEHOLDER_RE.test(secretValue)) return match;
      const index = match.indexOf(secretValue);
      if (index < 0) return match;
      return match.slice(0, index) + "[REDACTED-SECRET]" + match.slice(index + secretValue.length);
    });
}
