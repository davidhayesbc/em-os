const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SECRET_ASSIGNMENT_RE = /\b(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token)\b\s*[:=]\s*["']([^"'\n]{3,})["']/gi;

/**
 * Redact personal identifiers and secret-like assignments from connector text
 * before it is persisted.  Mirrors the repository-safety scanner's email and
 * assignment-secret patterns so that imported excerpts, titles and descriptions
 * never store raw emails or credential-shaped literals.
 */
export function redact(text: string): string {
  if (typeof text !== "string") throw new Error("redact input must be a string");
  return text
    .replace(EMAIL_RE, "[REDACTED-EMAIL]")
    .replace(SECRET_ASSIGNMENT_RE, (match, secretValue: string) => {
      const index = match.indexOf(secretValue);
      if (index < 0) return match;
      return match.slice(0, index) + "[REDACTED-SECRET]" + match.slice(index + secretValue.length);
    });
}
