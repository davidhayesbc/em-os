/**
 * Minimal YAML-like frontmatter parser for the em-template importer.
 * Supports scalar strings and inline `["a", "b"]` arrays, which is all the
 * fixture workspace uses.
 */

export function parseFrontmatter(text: string): Record<string, unknown> {
  if (!text.startsWith("---")) return {};
  const newline = text.indexOf("\n", 3);
  if (newline === -1) return {};

  // Standard terminator: `---` on its own line, with LF or CRLF.
  const delim = "\n---\n";
  const delimCr = "\n---\r\n";
  let close = text.indexOf(delim, newline + 1);
  if (close === -1) close = text.indexOf(delimCr, newline + 1);
  if (close === -1) {
    // End-of-file terminator.
    if (text.slice(-4) === "\n---") {
      close = text.length - 4;
    } else if (text.slice(-5) === "\r\n---") {
      close = text.length - 5;
    } else {
      return {};
    }
  }
  const body = text.slice(newline + 1, close).replace(/\r\n/g, "\n");
  const result: Record<string, unknown> = {};
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    result[key] = parseValue(value);
  }
  return result;
}

function parseValue(value: string): unknown {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => parseScalar(s.trim()));
  }
  return parseScalar(value);
}

function parseScalar(value: string): unknown {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  const num = Number(value);
  if (!Number.isNaN(num) && value !== "") return num;
  return value;
}
