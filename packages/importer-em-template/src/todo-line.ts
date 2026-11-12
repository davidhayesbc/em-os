import type { LocalDate, Urgency } from "@emos/api-contract";

export interface TodoLine {
  done: boolean;
  date: LocalDate | null;
  owners: string[];
  text: string;
  priority: 0 | 1 | 2 | 3 | null;
  urgency: Urgency | null;
  due: LocalDate | null;
  blocked: boolean;
  waitingOn: string | null;
  tags: string[];
  workstream: string | null;
  supersedes: string[];
  ids: string[];
  line: number;
}

const CHECKBOX_RE = /^\s*-\s*\[(x| )\]\s*(.*)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const ID_INNER_RE = /id:(\S+)/g;

const URGENCY_VALUES = new Set<Urgency>(["now", "next", "soon", "later", "someday"]);
const VALID_PRIORITY = new Set<number>([0, 1, 2, 3]);

export function parseTodoLine(line: string, lineNo: number): TodoLine | null {
  const normalized = line.replace(/\r\n/g, "\n");
  const match = CHECKBOX_RE.exec(normalized);
  if (!match) return null;

  const done = match[1]?.toLowerCase() === "x";
  let rest = match[2] ?? "";

  const ids = extractIds(rest);
  // Strip HTML comments so they don't leak into text/tags.
  rest = rest.replace(/<!--[\s\S]*?-->/g, "").trim();

  let date = extractDate(rest);
  if (date) rest = rest.slice(date.length).trimStart();

  let owners: string[] = [];

  // Owner-first order: owner token(s) before a colon at the very start.
  const ownerFirst = /^([^\s:]+?)\s*:\s*/.exec(rest);
  if (ownerFirst) {
    owners = parseOwners(ownerFirst[1] ?? "");
    rest = rest.slice(ownerFirst[0].length);
    if (!date) {
      const d = extractDate(rest);
      if (d) {
        date = d;
        rest = rest.slice(d.length).trimStart();
      }
    }
  }

  // Remove any leading dash/em-dash separator after date/owner prefix.
  rest = rest.replace(/^[—–-]\s*/, "").trimStart();

  // Owner group in parentheses (date-first form).
  if (owners.length === 0) {
    const paren = /^\(([^)]+)\)\s*/.exec(rest);
    if (paren) {
      owners = parseOwners(paren[1] ?? "");
      rest = rest.slice(paren[0].length);
    }
  }

  const { text, priority, urgency, due, blocked, waitingOn, tags, workstream, supersedes } =
    extractBody(rest);

  return {
    done,
    date,
    owners,
    text,
    priority,
    urgency,
    due,
    blocked,
    waitingOn,
    tags,
    workstream,
    supersedes,
    ids,
    line: lineNo,
  };
}

function extractIds(rest: string): string[] {
  const found: string[] = [];
  for (const comment of rest.matchAll(/\u003c!--[\s\S]*?-->/g)) {
    const inner = comment[0];
    for (const m of inner.matchAll(ID_INNER_RE)) {
      const id = m[1];
      if (id) found.push(id);
    }
  }
  return sortIds(found);
}

function sortIds(ids: string[]): string[] {
  const isShort = (id: string) => /^[a-z0-9]{6}$/.test(id);
  return ids.sort((a, b) => {
    const aShort = isShort(a);
    const bShort = isShort(b);
    if (aShort && !bShort) return -1;
    if (!aShort && bShort) return 1;
    return a.localeCompare(b);
  });
}

function extractDate(rest: string): LocalDate | null {
  const m = DATE_RE.exec(rest);
  if (!m) return null;
  return m[0] as LocalDate;
}

function parseOwners(source: string): string[] {
  return source
    .split(/\s*[,+]\s*|\s+and\s+/)
    .map((s) => s.trim())
    .map(normalizeOwner)
    .filter((s): s is string => s !== null);
}

function normalizeOwner(token: string): string | null {
  if (!token) return null;
  const wiki = /^\[\[([^|\]]+)(?:\|([^|\]]+))?\]\]$/.exec(token);
  if (wiki) {
    const path = wiki[1] ?? "";
    const lastSegment = path.split("/").pop() ?? path;
    return titleCase(lastSegment.replace(/-/g, " "));
  }
  const lower = token.toLowerCase();
  if (lower === "me" || lower === "them") return lower;
  return titleCase(token.replace(/-/g, " "));
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      return word[0]?.toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function extractBody(raw: string): Omit<TodoLine, "done" | "date" | "owners" | "ids" | "line"> {
  const tags: string[] = [];
  const supersedes: string[] = [];
  let priority: 0 | 1 | 2 | 3 | null = null;
  let urgency: Urgency | null = null;
  let due: LocalDate | null = null;
  let blocked = false;
  let waitingOn: string | null = null;
  let workstream: string | null = null;

  const tokens: { start: number; end: number }[] = [];
  for (const m of raw.matchAll(/(^|\s)(![^\s#]+|#[^\s#]+)/g)) {
    const token = (m[2] ?? "").trim();
    if (!token) continue;
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    tokens.push({ start, end: start + token.length });

    if (token.startsWith("!")) {
      const body = token.slice(1);
      if (/^p[0-3]$/.test(body)) {
        const p = Number(body[1]);
        if (priority === null && VALID_PRIORITY.has(p)) priority = p as 0 | 1 | 2 | 3;
      } else if (URGENCY_VALUES.has(body as Urgency)) {
        if (urgency === null) urgency = body as Urgency;
      } else if (body === "blocked") {
        blocked = true;
      } else if (body.startsWith("waiting-")) {
        waitingOn = body.slice("waiting-".length).toLowerCase();
      } else if (DATE_RE.test(body)) {
        due = body as LocalDate;
      }
    } else if (token.startsWith("#")) {
      const body = token.slice(1);
      if (body.startsWith("ws:")) {
        if (workstream === null) workstream = body.slice("ws:".length);
      } else if (body.startsWith("supersedes:")) {
        supersedes.push(body.slice("supersedes:".length));
      } else if (body.startsWith("tag:")) {
        tags.push(body.slice("tag:".length));
      } else {
        tags.push(body);
      }
    }
  }

  // Remove metadata tokens from the raw text in reverse order to keep indices valid.
  let text = raw;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (!t) continue;
    text = text.slice(0, t.start) + text.slice(t.end);
  }

  text = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .trim()
    .replace(/\s+/g, " ");

  return { text, priority, urgency, due, blocked, waitingOn, tags, workstream, supersedes };
}
