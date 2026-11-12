import { ConnectorError } from "../runtime/errors.js";

export interface ResultMapping {
  items: string;
  nextCursor?: string | null;
  fields: Record<string, string>;
}

interface ParsedPath {
  root: boolean;
  segments: string[];
  spread: boolean;
}

function parsePath(path: string): ParsedPath {
  const trimmed = path.trim();
  let spread = false;
  let working = trimmed;
  if (working.endsWith("[*]")) {
    spread = true;
    working = working.slice(0, -3);
  }
  const root = working.startsWith("$");
  const withoutRoot = root ? working.slice(1) : working;
  const segments = withoutRoot
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { root, segments, spread };
}

function resolveOne(value: unknown, segments: string[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolvePath(raw: unknown, item: unknown, path: string): unknown {
  const alternatives = path.split("|").map((p) => p.trim());
  for (const alt of alternatives) {
    const { root, segments, spread } = parsePath(alt);
    const base = root ? raw : item;
    const resolved = resolveOne(base, segments);
    if (spread) {
      if (Array.isArray(resolved)) return resolved;
      return null;
    }
    if (resolved !== undefined && resolved !== null) {
      return resolved;
    }
  }
  return null;
}

/**
 * Apply a preset result mapping to a raw tool result. Path syntax:
 * - `$` starts a path from the raw root;
 * - `.key` selects an object property;
 * - `[*]` expands one array level;
 * - `|` separates fallbacks (first resolved value wins).
 */
export function applyResultMapping(
  raw: unknown,
  mapping: ResultMapping,
): { items: Record<string, unknown>[]; nextCursor: string | null } {
  const rawItems = resolvePath(raw, undefined, mapping.items);
  if (!Array.isArray(rawItems)) {
    throw new ConnectorError("schema", `items path "${mapping.items}" did not resolve to an array`);
  }

  const items: Record<string, unknown>[] = rawItems.map((rawItem) => {
    const mapped: Record<string, unknown> = {};
    for (const [field, path] of Object.entries(mapping.fields)) {
      mapped[field] = resolvePath(raw, rawItem, path);
    }
    return mapped;
  });

  const nextCursor = mapping.nextCursor
    ? (resolvePath(raw, undefined, mapping.nextCursor) as string | null)
    : null;

  return { items, nextCursor };
}
