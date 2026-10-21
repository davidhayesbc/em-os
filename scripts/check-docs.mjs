// Documentation-protocol checker: enforces the ADR protocol (docs/adr/README.md) and the
// plan-board protocol (docs/plans/README.md, AGENTS.md) so agents and humans can trust them.
//
// CLI: `node scripts/check-docs.mjs [root]`
//   - root defaults to the cwd; it reads `docs/adr/` and `docs/plans/` beneath it.
// Prints `file:line rule message` per violation and exits 1 if there are any.
//
// ADR rules   (docs/adr/NNNN-*.md, excluding README.md and TEMPLATE.md)
//   adr-filename   `^\d{4}-[a-z0-9-]+\.md$`
//   adr-number     numbers are unique and contiguous from 0001
//   adr-title      first line is `# ADR NNNN: <title>` with NNNN matching the filename
//   adr-status     `- **Status:** ` starts with Proposed | Accepted | Superseded by NNNN
//                  (the superseding ADR must exist)
//   adr-date       `- **Date:** YYYY-MM-DD`
//   adr-headings   `## Context`, `## Decision`, `## Alternatives considered`,
//                  `## Consequences` all present, in that order; `## Spike result` and
//                  `## Verification` headings must carry a `(YYYY-MM-DD)` date
//   adr-index      every ADR is in the docs/adr/README.md index exactly once, and every
//                  index row links to an existing file whose name matches its number
// Plan rules  (docs/plans/phase-*.md)
//   plan-board     board lines are `- [ ]|[x] **Pn-NN** … — deps: … — claim: …`;
//                  ids are unique and carry the plan's phase number
//   plan-section   every board id has one `### Task <id>:` section and vice versa
//   plan-deps      deps are `none`, `Phase N`, comma-separated ids, or free text starting
//                  `every …` (ids mentioned must still exist); ids must exist in the same
//                  plan or an earlier phase's plan
//   plan-claim     claim is `—`, `owner…`, `done · <ref>` or `<agent> · <branch>`
//   plan-state     `[x]` needs `claim: done · …` and `[x]` id deps; `claim: done` needs `[x]`
//   plan-steps     a `[x]` task's section has no unticked `- [ ] **Step` lines
//   plan-manual    a *manual* task is never `claim: —`
//   plans-index    docs/plans/README.md lists every phase-*.md plan
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ file: string; line: number; rule: string; message: string }} Violation */

const ADR_DIR = "docs/adr";
const PLANS_DIR = "docs/plans";
const ADR_NAME = /^(\d{4})-[a-z0-9-]+\.md$/;
const ADR_EXCLUDED = new Set(["README.md", "TEMPLATE.md"]);
const REQUIRED_HEADINGS = [
  "## Context",
  "## Decision",
  "## Alternatives considered",
  "## Consequences",
];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const TASK_ID = /^P(\d+)-\d{2}$/;
const ID_IN_TEXT = /\bP\d+-\d{2}\b/g;
const BOARD_LOOSE = /^- \[(.)\] \*\*P\d+/;
const BOARD_STRICT = /^- \[( |x)\] \*\*(P\d+-\d{2})\*\* (.*)$/;
const TASK_HEADING = /^### Task (P\d+-\d{2}):/;
const STEP_OPEN = /^\s*- \[ \] \*\*Step/;
const MANUAL_MARKER = /\*[^*\n]*\bmanual\b[^*\n]*\*/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isRealDate(text) {
  const m = DATE.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Split text into lines, tagging each with whether it sits inside a fenced code block
 * (the fence lines themselves count as inside), so examples never trip a rule.
 * @param {string} text
 * @returns {Array<{ n: number; text: string; fenced: boolean }>}
 */
export function lines(text) {
  const out = [];
  let fence = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(raw);
    let fenced = fence !== null;
    if (m) {
      if (fence === null) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      fenced = true;
    }
    out.push({ n: i + 1, text: raw, fenced });
  });
  return out;
}

// ---------------------------------------------------------------------------- ADRs

/**
 * @param {{ adrs: Record<string, string>; index: string }} input
 *   `adrs`: file name -> text for every file in docs/adr/ (README.md and TEMPLATE.md are
 *   skipped); `index`: text of docs/adr/README.md.
 * @returns {Violation[]}
 */
export function checkAdrs({ adrs, index }) {
  /** @type {Violation[]} */
  const out = [];
  const add = (name, line, rule, message) =>
    out.push({ file: `${ADR_DIR}/${name}`, line, rule, message });

  const names = Object.keys(adrs)
    .filter((n) => n.endsWith(".md") && !ADR_EXCLUDED.has(n))
    .sort();

  // Numbering: unique, contiguous from 0001.
  /** @type {Map<number, string[]>} */
  const byNumber = new Map();
  for (const name of names) {
    const m = ADR_NAME.exec(name);
    if (!m) {
      add(name, 1, "adr-filename", `file name must match ^\\d{4}-[a-z0-9-]+\\.md$`);
      continue;
    }
    const n = Number(m[1]);
    byNumber.set(n, [...(byNumber.get(n) ?? []), name]);
  }
  for (const [n, files] of byNumber) {
    if (files.length > 1) {
      for (const f of files)
        add(f, 1, "adr-number", `ADR number ${pad(n)} is used by ${files.join(", ")}`);
    }
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  numbers.forEach((n, i) => {
    if (n !== i + 1) {
      const file = byNumber.get(n)?.[0] ?? "";
      add(
        file,
        1,
        "adr-number",
        `numbers must be contiguous from 0001: expected ${pad(i + 1)} before ${pad(n)}`,
      );
    }
  });
  const existing = new Set(numbers);

  for (const name of names) {
    const m = ADR_NAME.exec(name);
    if (!m) continue;
    checkAdr(name, m[1], adrs[name], existing, add);
  }

  checkAdrIndex(names, index, add);
  return out;
}

function pad(n) {
  return String(n).padStart(4, "0");
}

function checkAdr(name, num, text, existing, add) {
  const all = lines(text);

  // Title.
  const title = /^# ADR (\d{4}): \S/.exec(all[0]?.text ?? "");
  if (!title) add(name, 1, "adr-title", "first line must be `# ADR NNNN: <title>`");
  else if (title[1] !== num) {
    add(name, 1, "adr-title", `title number ${title[1]} does not match file name number ${num}`);
  }

  // Header fields live before the first `## ` heading.
  const firstH2 = all.findIndex((l) => !l.fenced && l.text.startsWith("## "));
  const header = all.slice(0, firstH2 === -1 ? all.length : firstH2).filter((l) => !l.fenced);

  const status = header.find((l) => l.text.startsWith("- **Status:**"));
  if (!status) add(name, 1, "adr-status", "missing a `- **Status:** ` line");
  else {
    const value = status.text.slice("- **Status:**".length).trim();
    const sup = /^Superseded by (\d{4})(?![\w-])/.exec(value);
    if (/^Superseded\b/.test(value) && !sup) {
      add(name, status.n, "adr-status", "`Superseded` must read `Superseded by NNNN`");
    } else if (sup) {
      if (sup[1] === num) add(name, status.n, "adr-status", "an ADR cannot supersede itself");
      else if (!existing.has(Number(sup[1]))) {
        add(name, status.n, "adr-status", `superseding ADR ${sup[1]} does not exist`);
      }
    } else if (!/^(?:Proposed|Accepted)(?![\w-])/.test(value)) {
      add(
        name,
        status.n,
        "adr-status",
        `status must start with Proposed, Accepted or Superseded by NNNN (got \`${value}\`)`,
      );
    }
  }

  const date = header.find((l) => l.text.startsWith("- **Date:**"));
  if (!date) add(name, 1, "adr-date", "missing a `- **Date:** YYYY-MM-DD` line");
  else if (!isRealDate(date.text.slice("- **Date:**".length).trim())) {
    add(name, date.n, "adr-date", "Date must be a real YYYY-MM-DD date");
  }

  // Headings.
  const h2 = all.filter((l) => !l.fenced && /^## /.test(l.text));
  let last = -1;
  let lastHeading = "";
  for (const heading of REQUIRED_HEADINGS) {
    const idx = h2.findIndex((l) => l.text.trim() === heading);
    if (idx === -1) add(name, 1, "adr-headings", `missing required heading \`${heading}\``);
    else if (idx < last) {
      add(name, h2[idx].n, "adr-headings", `\`${heading}\` must come after \`${lastHeading}\``);
    } else {
      last = idx;
      lastHeading = heading;
    }
  }
  for (const l of h2) {
    if (/^## (?:Spike result|Verification)/.test(l.text)) {
      if (!/^## (?:Spike result|Verification) \((\d{4}-\d{2}-\d{2})\)$/.test(l.text.trim())) {
        add(
          name,
          l.n,
          "adr-headings",
          `\`${l.text.trim()}\` must read \`## <Spike result|Verification> (YYYY-MM-DD)\``,
        );
      } else if (!isRealDate(/\((.*)\)/.exec(l.text)?.[1] ?? "")) {
        add(name, l.n, "adr-headings", `\`${l.text.trim()}\` has an invalid date`);
      }
    }
  }
}

function checkAdrIndex(names, index, add) {
  const fileSet = new Set(names);
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const l of lines(index)) {
    if (l.fenced) continue;
    const row = /^\|\s*\[(\d{4})\]\(([^)]+)\)/.exec(l.text);
    if (!row) continue;
    const [, num, target] = row;
    const target0 = target.replace(/#.*$/, "");
    seen.set(target0, (seen.get(target0) ?? 0) + 1);
    const push = (message) => add("README.md", l.n, "adr-index", message);
    if (!target0.startsWith(`${num}-`)) push(`link text ${num} does not match target ${target0}`);
    if (!fileSet.has(target0)) push(`index row points at missing file ${target0}`);
    else if ((seen.get(target0) ?? 0) > 1) push(`${target0} appears more than once in the index`);
  }
  for (const name of names) {
    if (!ADR_NAME.test(name)) continue;
    if (!seen.has(name))
      add("README.md", 1, "adr-index", `${name} is missing from the index table`);
  }
}

// ------------------------------------------------------------------------- plans

/**
 * @typedef {{ id: string; line: number; checked: boolean; deps: string; claim: string;
 *   rest: string }} BoardTask
 * @typedef {{ file: string; phase: number; text: string; tasks: BoardTask[] }} ParsedPlan
 */

/**
 * @param {{ plans: Record<string, string>; index: string }} input
 *   `plans`: file name (`phase-N-*.md`) -> text; `index`: text of docs/plans/README.md.
 * @returns {Violation[]}
 */
export function checkPlans({ plans, index }) {
  /** @type {Violation[]} */
  const out = [];
  const names = Object.keys(plans)
    .filter((n) => /^phase-.*\.md$/.test(n))
    .sort();

  /** @type {ParsedPlan[]} */
  const parsed = [];
  for (const name of names) {
    const add = (line, rule, message) =>
      out.push({ file: `${PLANS_DIR}/${name}`, line, rule, message });
    const phase = /^phase-(\d+)-/.exec(name);
    if (!phase) {
      add(1, "plan-board", "plan file name must look like phase-N-<slug>.md");
      continue;
    }
    parsed.push(parseBoard(name, Number(phase[1]), plans[name], add));
  }

  // Ids per phase, across all plans, for cross-plan dependency lookups.
  /** @type {Map<string, { checked: boolean }>} */
  const known = new Map();
  /** @type {Set<number>} */
  const phases = new Set();
  for (const p of parsed) {
    phases.add(p.phase);
    for (const t of p.tasks) if (!known.has(t.id)) known.set(t.id, { checked: t.checked });
  }

  for (const plan of parsed) {
    const add = (line, rule, message) =>
      out.push({ file: `${PLANS_DIR}/${plan.file}`, line, rule, message });
    checkPlan(plan, known, phases, add);
  }

  checkPlansIndex(names, index, out);
  return out;
}

/** @returns {ParsedPlan} */
function parseBoard(file, phase, text, add) {
  /** @type {BoardTask[]} */
  const tasks = [];
  const ids = new Map();
  for (const l of lines(text)) {
    if (l.fenced || !BOARD_LOOSE.test(l.text)) continue;
    const m = BOARD_STRICT.exec(l.text);
    if (!m) {
      add(
        l.n,
        "plan-board",
        "board line must match `- [ ]|[x] **Pn-NN** <title> — deps: … — claim: …`",
      );
      continue;
    }
    const [, mark, id, rest] = m;
    const idm = TASK_ID.exec(id);
    if (idm && Number(idm[1]) !== phase) {
      add(
        l.n,
        "plan-board",
        `${id} does not belong in a phase ${phase} plan (expected P${phase}-NN)`,
      );
    }
    if (ids.has(id)) {
      add(l.n, "plan-board", `${id} is already on the board at line ${ids.get(id)}`);
      continue;
    }
    ids.set(id, l.n);

    const parts = /^(.*?)\bdeps: (.*?) — claim: (.*)$/.exec(rest);
    if (!parts) {
      add(l.n, "plan-board", `${id}: board line needs \`deps: … — claim: …\``);
      continue;
    }
    // `blocked: <reason>` may trail the claim; it is not part of the claim value.
    const claim = parts[3].replace(/\s+(?:— )?blocked:.*$/, "").trim();
    tasks.push({ id, line: l.n, checked: mark === "x", deps: parts[2].trim(), claim, rest });
  }
  if (ids.size === 0) add(1, "plan-board", "plan has no task board lines");

  return { file, phase, text, tasks };
}

function checkPlan(plan, known, phases, add) {
  const { tasks } = plan;
  const text = lines(plan.text);

  // Sections: id -> { line, end } where the section runs to the next `###`/`##` heading.
  /** @type {Map<string, { line: number; from: number; to: number }>} */
  const sections = new Map();
  let open = null;
  text.forEach((l, i) => {
    if (l.fenced) return;
    const heading = /^#{2,3} /.test(l.text);
    if (open && heading) {
      open.to = i;
      open = null;
    }
    const m = TASK_HEADING.exec(l.text);
    if (m) {
      if (sections.has(m[1])) {
        add(
          l.n,
          "plan-section",
          `duplicate section for ${m[1]} (first at line ${sections.get(m[1])?.line})`,
        );
      } else {
        open = { line: l.n, from: i + 1, to: text.length };
        sections.set(m[1], open);
      }
    }
  });

  const boardIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    if (!sections.has(t.id))
      add(
        t.line,
        "plan-section",
        `${t.id} is on the board but has no \`### Task ${t.id}:\` section`,
      );
  }
  for (const [id, s] of sections) {
    if (!boardIds.has(id)) add(s.line, "plan-section", `section for ${id} has no board line`);
  }

  for (const t of tasks) {
    checkClaim(t, add);
    checkDeps(t, plan, known, phases, add);

    // State consistency.
    const done = /^done · \S/.test(t.claim);
    if (t.checked && !done)
      add(t.line, "plan-state", `${t.id} is [x] but claim is not \`done · <ref>\``);
    if (!t.checked && /^done\b/.test(t.claim)) {
      add(t.line, "plan-state", `${t.id} has \`claim: done\` but is not [x]`);
    }
    if (t.checked) {
      for (const dep of depIds(t.deps)) {
        const d = known.get(dep);
        if (d && !d.checked)
          add(t.line, "plan-state", `${t.id} is [x] but dependency ${dep} is not`);
      }
      const s = sections.get(t.id);
      if (s) {
        for (let i = s.from; i < s.to; i++) {
          if (!text[i].fenced && STEP_OPEN.test(text[i].text)) {
            add(text[i].n, "plan-steps", `${t.id} is [x] but this step is unticked`);
          }
        }
      }
    }

    // Manual tasks must not sit unclaimed for an agent to trip over.
    if (MANUAL_MARKER.test(t.rest.slice(0, t.rest.indexOf("deps:"))) && t.claim === "—") {
      add(t.line, "plan-manual", `${t.id} is *manual* but \`claim: —\`; use \`claim: owner\``);
    }
  }
}

function checkClaim(t, add) {
  const c = t.claim;
  if (c === "—") return;
  if (/^owner(?![\w-])/.test(c)) return;
  if (/^done · \S/.test(c)) return;
  if (/^done\b/.test(c))
    return add(t.line, "plan-claim", `${t.id}: \`done\` needs a reference: \`done · <commit>\``);
  if (/^\S.* · \S/.test(c)) return;
  add(
    t.line,
    "plan-claim",
    `${t.id}: claim must be \`—\`, \`owner…\`, \`done · <ref>\` or \`<agent> · <branch>\` (got \`${c}\`)`,
  );
}

/** Ids a deps value refers to, whatever its form. */
function depIds(deps) {
  return deps.match(ID_IN_TEXT) ?? [];
}

function checkDeps(t, plan, known, phases, add) {
  const deps = t.deps;
  if (deps === "") return add(t.line, "plan-deps", `${t.id}: deps is empty; use \`none\``);

  if (/^every\b/.test(deps)) {
    // Free text, e.g. `every P1 task except P1-37`: only mentioned ids are validated.
    return checkDepIds(t, depIds(deps), plan, known, phases, add);
  }

  const tokens = deps.split(/\s*,\s*/);
  const ids = [];
  for (const tok of tokens) {
    if (TASK_ID.test(tok)) ids.push(tok);
    else if (tok === "none" && tokens.length === 1) continue;
    else if (/^Phase \d+$/.test(tok)) {
      const n = Number(tok.slice(6));
      if (n >= plan.phase)
        add(t.line, "plan-deps", `${t.id}: \`${tok}\` must be an earlier phase than ${plan.phase}`);
    } else {
      add(
        t.line,
        "plan-deps",
        `${t.id}: dependency \`${tok}\` must be \`none\`, \`Phase N\` or a task id`,
      );
    }
  }
  checkDepIds(t, ids, plan, known, phases, add);
}

function checkDepIds(t, ids, plan, known, phases, add) {
  for (const id of ids) {
    const phase = Number(TASK_ID.exec(id)?.[1]);
    if (id === t.id) add(t.line, "plan-deps", `${t.id} depends on itself`);
    else if (phase > plan.phase)
      add(t.line, "plan-deps", `${t.id}: ${id} belongs to a later phase`);
    else if (!known.has(id)) {
      const where =
        phase === plan.phase
          ? "this plan"
          : phases.has(phase)
            ? `the phase ${phase} plan`
            : `any plan (no phase ${phase} plan)`;
      add(t.line, "plan-deps", `${t.id}: dependency ${id} does not exist in ${where}`);
    }
  }
}

function checkPlansIndex(names, index, out) {
  const file = `${PLANS_DIR}/README.md`;
  const listed = new Set();
  for (const l of lines(index)) {
    if (l.fenced || !l.text.startsWith("|")) continue;
    for (const m of l.text.matchAll(/\]\((phase-[^)#]*\.md)(?:#[^)]*)?\)/g)) {
      listed.add(m[1]);
      if (!names.includes(m[1])) {
        out.push({
          file,
          line: l.n,
          rule: "plans-index",
          message: `status table links to missing plan ${m[1]}`,
        });
      }
    }
  }
  for (const name of names) {
    if (!listed.has(name)) {
      out.push({
        file,
        line: 1,
        rule: "plans-index",
        message: `${name} is not listed in the status table`,
      });
    }
  }
}

// -------------------------------------------------------------------------- driver

function readDir(dir) {
  /** @type {Record<string, string>} */
  const files = {};
  if (!existsSync(dir)) return files;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".md"))
      files[e.name] = readFileSync(join(dir, e.name), "utf8");
  }
  return files;
}

/**
 * Check the docs under `root`. Missing docs/adr or docs/plans directories are reported
 * as violations, since a repo that ships this checker is expected to have both.
 * @param {string} root
 * @returns {Violation[]}
 */
export function checkDocs(root) {
  const adrFiles = readDir(join(root, ADR_DIR));
  const planFiles = readDir(join(root, PLANS_DIR));
  /** @type {Violation[]} */
  const out = [];
  if (!("README.md" in adrFiles)) {
    out.push({
      file: `${ADR_DIR}/README.md`,
      line: 1,
      rule: "adr-index",
      message: "ADR index (README.md) not found",
    });
  }
  if (!("README.md" in planFiles)) {
    out.push({
      file: `${PLANS_DIR}/README.md`,
      line: 1,
      rule: "plans-index",
      message: "plans index (README.md) not found",
    });
  }
  const { "README.md": adrIndex = "", ...adrs } = adrFiles;
  const { "README.md": plansIndex = "", ...plans } = planFiles;
  out.push(...checkAdrs({ adrs, index: adrIndex }));
  out.push(...checkPlans({ plans, index: plansIndex }));
  return out;
}

/** @param {Violation} v */
export function format(v) {
  return `${v.file}:${v.line} ${v.rule} ${v.message}`;
}

/**
 * @param {string[]} args  CLI arguments (without node/script).
 * @returns {number} exit code
 */
export function main(args, cwd = process.cwd()) {
  const root = args[0] ? resolve(cwd, args[0]) : cwd;
  const violations = checkDocs(root);
  for (const v of violations) console.log(format(v));
  if (violations.length > 0) {
    console.error(
      `check-docs: ${violations.length} violation(s). See docs/adr/README.md and docs/plans/README.md.`,
    );
    return 1;
  }
  console.log("check-docs: ok");
  return 0;
}

// Compare real paths so a symlinked invocation still runs the check (failing open here
// would silently pass the gate).
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
