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

const FORBIDDEN_SEGMENTS = new Set<string>(["__proto__", "constructor", "prototype"]);

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
    if (FORBIDDEN_SEGMENTS.has(segment)) {
      return undefined;
    }
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

type Resolution =
  | { kind: "value"; value: unknown }
  | { kind: "missing" }
  | { kind: "notArray"; value: unknown };

function resolvePath(raw: unknown, item: unknown, path: string): Resolution {
  const alternatives = path.split("|").map((p) => p.trim());
  let notArrayCandidate: unknown | undefined;
  for (const alt of alternatives) {
    const { root, segments, spread } = parsePath(alt);
    const base = root ? raw : item;
    const resolved = resolveOne(base, segments);
    if (spread) {
      if (Array.isArray(resolved)) return { kind: "value", value: resolved };
      if (resolved !== undefined && resolved !== null) {
        notArrayCandidate = resolved;
      }
      continue;
    }
    if (resolved !== undefined && resolved !== null) {
      return { kind: "value", value: resolved };
    }
  }
  return notArrayCandidate !== undefined
    ? { kind: "notArray", value: notArrayCandidate }
    : { kind: "missing" };
}

function resolvedValue(res: Resolution): unknown {
  return res.kind === "value" ? res.value : null;
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
  const itemsRes = resolvePath(raw, undefined, mapping.items);
  if (itemsRes.kind === "notArray") {
    throw new ConnectorError(
      "schema",
      `items path "${mapping.items}" resolved to a non-array value`,
    );
  }
  const rawItems: unknown[] = itemsRes.kind === "missing" ? [] : (itemsRes.value as unknown[]);

  const items: Record<string, unknown>[] = rawItems.map((rawItem) => {
    const mapped: Record<string, unknown> = {};
    for (const [field, path] of Object.entries(mapping.fields)) {
      mapped[field] = resolvedValue(resolvePath(raw, rawItem, path));
    }
    return mapped;
  });

  let nextCursor: string | null = null;
  if (mapping.nextCursor) {
    const cursorRes = resolvePath(raw, undefined, mapping.nextCursor);
    if (cursorRes.kind === "value" && typeof cursorRes.value === "string") {
      nextCursor = cursorRes.value;
    }
  }

  return { items, nextCursor };
}
