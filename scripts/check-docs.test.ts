import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAdrs, checkDocs, checkPlans, format, isRealDate } from "./check-docs.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-docs.mjs");

const adr = (n: string, over: { status?: string; date?: string; extra?: string } = {}) =>
  [
    `# ADR ${n}: A decision`,
    "",
    `- **Status:** ${over.status ?? "Accepted"}`,
    `- **Date:** ${over.date ?? "2026-10-19"}`,
    "",
    "## Context",
    "c",
    "## Decision",
    "d",
    "## Alternatives considered",
    "a",
    "## Consequences",
    "q",
    over.extra ?? "",
    "",
  ].join("\n");

const adrIndex = (...rows: string[]) =>
  ["| ADR | Status | Decision |", "|---|---|---|", ...rows].join("\n");
const row = (n: string, file = `${n}-a-decision.md`) => `| [${n}](${file}) | Accepted | x |`;

function adrs(input: Record<string, string>, index: string) {
  return checkAdrs({ adrs: input, index });
}
const rules = (v: Array<{ rule: string }>) => v.map((x) => x.rule);

describe("isRealDate", () => {
  it("accepts calendar dates and rejects impossible ones", () => {
    expect(isRealDate("2026-10-19")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-1-19")).toBe(false);
    expect(isRealDate("TBD")).toBe(false);
  });
});

describe("checkAdrs", () => {
  const good = {
    "0001-a-decision.md": adr("0001"),
    "0002-a-decision.md": adr("0002", { status: "Superseded by 0003" }),
    "0003-a-decision.md": adr("0003", {
      status: "Accepted; driver chosen by spike",
      extra: "## Spike result (2026-10-20)\nx\n## Verification (2026-10-21)\ny\n## Discovery\nz",
    }),
  };
  const goodIndex = adrIndex(row("0001"), row("0002"), row("0003"));

  it("passes a well-formed set, ignoring README and TEMPLATE", () => {
    const set = { ...good, "README.md": "x", "TEMPLATE.md": "# ADR NNNN: <T>" };
    expect(adrs(set, goodIndex)).toEqual([]);
  });

  it("flags a bad file name and gaps or duplicates in numbering", () => {
    expect(rules(adrs({ ...good, "0004_Bad.md": adr("0004") }, goodIndex))).toContain(
      "adr-filename",
    );
    const gap = { "0001-a-decision.md": adr("0001"), "0003-a-decision.md": adr("0003") };
    const v = adrs(gap, adrIndex(row("0001"), row("0003")));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: "adr-number", file: "docs/adr/0003-a-decision.md" });
    const dup = { "0001-a-decision.md": adr("0001"), "0001-other.md": adr("0001") };
    expect(rules(adrs(dup, adrIndex(row("0001"), row("0001", "0001-other.md"))))).toEqual([
      "adr-number",
      "adr-number",
    ]);
  });

  it("requires the title to carry the file's number", () => {
    const v = adrs({ ...good, "0001-a-decision.md": adr("0009") }, goodIndex);
    expect(v).toEqual([expect.objectContaining({ rule: "adr-title", line: 1 })]);
    const bare = { ...good, "0001-a-decision.md": adr("0001").replace("# ADR 0001:", "# 0001 -") };
    expect(rules(adrs(bare, goodIndex))).toEqual(["adr-title"]);
  });

  it("checks status values and the superseding ADR", () => {
    const bad = (status: string) =>
      adrs({ ...good, "0001-a-decision.md": adr("0001", { status }) }, goodIndex);
    expect(bad("Draft")[0]).toMatchObject({ rule: "adr-status", line: 3 });
    expect(bad("Acceptedish")[0]?.rule).toBe("adr-status");
    expect(bad("Superseded")[0]?.rule).toBe("adr-status");
    expect(bad("Superseded by 0099")[0]?.message).toContain("does not exist");
    expect(bad("Superseded by 0001")[0]?.message).toContain("itself");
    expect(bad("Proposed")).toEqual([]);
    expect(bad("Superseded by 0003")).toEqual([]);
    const missing = adr("0001").replace(/- \*\*Status:\*\*.*\n/, "");
    expect(rules(adrs({ ...good, "0001-a-decision.md": missing }, goodIndex))).toEqual([
      "adr-status",
    ]);
  });

  it("requires a real date", () => {
    for (const date of ["TBD", "2026-13-01", "2026-10-1"]) {
      const v = adrs({ ...good, "0001-a-decision.md": adr("0001", { date }) }, goodIndex);
      expect(v).toEqual([expect.objectContaining({ rule: "adr-date", line: 4 })]);
    }
  });

  it("requires headings in order and dated Spike result / Verification headings", () => {
    const swapped = adr("0001")
      .replace("## Decision", "## TMP")
      .replace("## Context", "## Decision")
      .replace("## TMP", "## Context");
    expect(adrs({ ...good, "0001-a-decision.md": swapped }, goodIndex)[0]).toMatchObject({
      rule: "adr-headings",
    });
    const missing = adr("0001").replace("## Consequences", "## Outcome");
    expect(adrs({ ...good, "0001-a-decision.md": missing }, goodIndex)[0]?.message).toContain(
      "## Consequences",
    );
    for (const extra of [
      "## Spike result",
      "## Verification (soon)",
      "## Verification (2026-02-30)",
    ]) {
      const v = adrs({ ...good, "0001-a-decision.md": adr("0001", { extra }) }, goodIndex);
      expect(rules(v)).toEqual(["adr-headings"]);
    }
  });

  it("ignores headings and fields inside code fences", () => {
    const fenced = adr("0001", { extra: "```md\n## Spike result\n```" });
    expect(adrs({ ...good, "0001-a-decision.md": fenced }, goodIndex)).toEqual([]);
  });

  it("keeps the index and the files in step", () => {
    const missingRow = adrs(good, adrIndex(row("0001"), row("0002")));
    expect(missingRow).toEqual([
      expect.objectContaining({ rule: "adr-index", file: "docs/adr/README.md" }),
    ]);
    expect(missingRow[0]?.message).toContain("0003-a-decision.md is missing");
    const ghost = adrs(good, adrIndex(row("0001"), row("0002"), row("0003"), row("0004")));
    expect(ghost[0]?.message).toContain("missing file 0004-a-decision.md");
    const twice = adrs(good, adrIndex(row("0001"), row("0001"), row("0002"), row("0003")));
    expect(twice[0]?.message).toContain("more than once");
    const mismatch = adrs(
      good,
      adrIndex(row("0001"), row("0002"), row("0009", "0003-a-decision.md")),
    );
    expect(mismatch[0]?.message).toContain("does not match target");
  });
});

const board = (...l: string[]) => ["## Task board", "", ...l, "", "---", ""].join("\n");
const section = (id: string, steps: string[] = ["- [x] **Step 1: Do it.**"]) =>
  [`### Task ${id}: Title`, "", "**Files:** `a`.", "", ...steps, ""].join("\n");
const planIndex = (...names: string[]) =>
  ["| Plan | Status |", "|---|---|", ...names.map((n) => `| [${n}](${n}) | ok |`)].join("\n");

const p0 = [
  board(
    "- [x] **P0-01** Setup — deps: none — claim: done · abc123",
    "- [ ] **P0-02** *spike, manual* S — deps: P0-01 — claim: owner",
  ),
  section("P0-01"),
  section("P0-02", ["- [ ] **Step 1: Try.**"]),
].join("\n");
const p1 = [
  board(
    "- [ ] **P1-00** First — deps: Phase 0 — claim: —",
    "- [ ] **P1-01** Second — deps: P1-00, P0-01 — claim: agent-1 · p1-01-second",
    "- [ ] **P1-02** *manual + CI* Pub — deps: P0-02 — claim: owner (steps 1 and 4); an agent may do the rest",
    "- [ ] **P1-03** Close — deps: every P1 task except P1-02 — claim: —",
  ),
  section("P1-00", ["- [ ] **Step 1: x.**"]),
  section("P1-01"),
  section("P1-02"),
  section("P1-03"),
].join("\n");
const goodPlans = { "phase-0-foundations.md": p0, "phase-1-daily-driver.md": p1 };
const goodPlanIndex = planIndex("phase-0-foundations.md", "phase-1-daily-driver.md");

function plans(over: Record<string, string> = {}, index = goodPlanIndex) {
  return checkPlans({ plans: { ...goodPlans, ...over }, index });
}
const edit = (text: string, from: string, to: string) => {
  expect(text).toContain(from);
  return text.replace(from, to);
};

describe("checkPlans", () => {
  it("passes well-formed plans, including free-text `every …` deps and owner claims", () => {
    expect(plans()).toEqual([]);
  });

  it("flags malformed board lines and ids from the wrong phase", () => {
    const noClaim = edit(p1, "deps: Phase 0 — claim: —", "deps: Phase 0");
    expect(plans({ "phase-1-daily-driver.md": noClaim })[0]).toMatchObject({ rule: "plan-board" });
    const wrongPhase = edit(p1, "**P1-00**", "**P0-09**");
    expect(
      plans({ "phase-1-daily-driver.md": wrongPhase })
        .map((v) => v.message)
        .join("\n"),
    ).toContain("does not belong in a phase 1 plan");
    const dup = edit(p1, "**P1-01** Second", "**P1-00** Second");
    expect(
      plans({ "phase-1-daily-driver.md": dup })
        .map((v) => v.message)
        .join("\n"),
    ).toContain("already on the board");
  });

  it("pairs board ids with task sections both ways", () => {
    const noSection = edit(p1, "### Task P1-01: Title", "### Task P1-09: Title");
    const msgs = plans({ "phase-1-daily-driver.md": noSection }).map((v) => v.message);
    expect(msgs).toEqual([
      expect.stringContaining("P1-01 is on the board but has no"),
      expect.stringContaining("section for P1-09 has no board line"),
    ]);
  });

  it("validates dependency forms and targets", () => {
    const dep = (deps: string) =>
      plans({ "phase-1-daily-driver.md": edit(p1, "deps: Phase 0 —", `deps: ${deps} —`) });
    expect(dep("none")).toEqual([]);
    expect(dep("P1-01, P0-02")).toEqual([]);
    expect(dep("P1-77")[0]?.message).toContain("does not exist in this plan");
    expect(dep("P0-77")[0]?.message).toContain("does not exist in the phase 0 plan");
    expect(dep("P4-01")[0]?.message).toContain("later phase");
    expect(dep("P1-00")[0]?.message).toContain("itself");
    expect(dep("soon")[0]?.rule).toBe("plan-deps");
    expect(dep("")[0]?.rule).toBe("plan-deps");
    expect(dep("Phase 1")[0]?.message).toContain("earlier phase");
    const ghost = edit(p1, "except P1-02", "except P1-98");
    expect(plans({ "phase-1-daily-driver.md": ghost })[0]?.message).toContain("P1-98");
  });

  it("validates claim forms", () => {
    const claim = (c: string) =>
      plans({
        "phase-1-daily-driver.md": edit(
          p1,
          "deps: Phase 0 — claim: —",
          `deps: Phase 0 — claim: ${c}`,
        ),
      });
    expect(claim("—")).toEqual([]);
    expect(claim("owner")).toEqual([]);
    expect(claim("agent-2 · p1-00-first")).toEqual([]);
    expect(claim("agent-2 · p1-00-first — blocked: needs ADR")).toEqual([]);
    expect(claim("agent-2")[0]?.rule).toBe("plan-claim");
    expect(claim("owner-ish")[0]?.rule).toBe("plan-claim");
    expect(claim("done")[0]?.rule).toBe("plan-claim");
    expect(claim("")[0]?.rule).toBe("plan-claim");
  });

  it("keeps [x], claim: done and [x] dependencies consistent", () => {
    const noDone = edit(p0, "claim: done · abc123", "claim: —");
    expect(rules(plans({ "phase-0-foundations.md": noDone }))).toContain("plan-state");
    const doneUnticked = edit(
      p0,
      "- [ ] **P0-02** *spike, manual* S — deps: P0-01 — claim: owner",
      "- [ ] **P0-02** *spike, manual* S — deps: P0-01 — claim: done · abc",
    );
    expect(plans({ "phase-0-foundations.md": doneUnticked })[0]?.message).toContain("is not [x]");
    const earlyTick = edit(p1, "- [ ] **P1-01** Second", "- [x] **P1-01** Second").replace(
      "claim: agent-1 · p1-01-second",
      "claim: done · def456",
    );
    const v = plans({ "phase-1-daily-driver.md": earlyTick });
    expect(v.map((x) => x.message)).toEqual([expect.stringContaining("dependency P1-00 is not")]);
  });

  it("rejects unticked steps under a [x] task", () => {
    const stale = edit(p0, "- [x] **Step 1: Do it.**", "- [ ] **Step 1: Do it.**");
    const v = plans({ "phase-0-foundations.md": stale });
    expect(v).toEqual([expect.objectContaining({ rule: "plan-steps" })]);
    expect(v[0]?.line).toBeGreaterThan(5);
  });

  it("does not let a section's steps leak into the next task", () => {
    // P1-00 has an open step but is unticked; P1-01 (ticked) must not inherit it.
    const ticked = edit(p1, "- [ ] **P1-00** First", "- [x] **P1-00** First").replace(
      "deps: Phase 0 — claim: —",
      "deps: Phase 0 — claim: done · aaa",
    );
    const v = plans({ "phase-1-daily-driver.md": ticked });
    expect(v).toEqual([
      expect.objectContaining({ rule: "plan-steps", message: expect.stringContaining("P1-00") }),
    ]);
  });

  it("forbids unclaimed manual tasks but not owner, agent or done ones", () => {
    const unclaimed = edit(
      p1,
      "deps: P0-02 — claim: owner (steps 1 and 4); an agent may do the rest",
      "deps: P0-02 — claim: —",
    );
    expect(plans({ "phase-1-daily-driver.md": unclaimed })).toEqual([
      expect.objectContaining({ rule: "plan-manual" }),
    ]);
    const agent = edit(
      p1,
      "claim: owner (steps 1 and 4); an agent may do the rest",
      "claim: agent-3 · p1-02-pub",
    );
    expect(plans({ "phase-1-daily-driver.md": agent })).toEqual([]);
    const spike = edit(p0, "claim: owner", "claim: —");
    expect(rules(plans({ "phase-0-foundations.md": spike }))).toEqual(["plan-manual"]);
  });

  it("requires every phase plan in the README status table", () => {
    const v = plans({}, planIndex("phase-0-foundations.md"));
    expect(v).toEqual([
      expect.objectContaining({ rule: "plans-index", file: "docs/plans/README.md" }),
    ]);
    expect(v[0]?.message).toContain("phase-1-daily-driver.md");
    const ghost = plans(
      {},
      planIndex("phase-0-foundations.md", "phase-1-daily-driver.md", "phase-2-x.md"),
    );
    expect(ghost[0]?.message).toContain("missing plan phase-2-x.md");
  });
});

describe("format", () => {
  it("prints file:line rule message", () => {
    expect(format({ file: "a.md", line: 3, rule: "r", message: "m" })).toBe("a.md:3 r m");
  });
});

describe("CLI", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "check-docs-"));
    mkdirSync(join(dir, "docs/adr"), { recursive: true });
    mkdirSync(join(dir, "docs/plans"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function write(rel: string, text: string) {
    writeFileSync(join(dir, rel), text);
  }
  function seed() {
    write("docs/adr/0001-a-decision.md", adr("0001"));
    write("docs/adr/README.md", adrIndex(row("0001")));
    write("docs/plans/phase-0-foundations.md", p0);
    write("docs/plans/README.md", planIndex("phase-0-foundations.md"));
  }
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });

  it("exits 0 on a clean tree", () => {
    seed();
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("check-docs: ok");
    expect(checkDocs(dir)).toEqual([]);
  });

  it("exits 1 and prints file:line rule message per violation", () => {
    seed();
    write("docs/adr/0001-a-decision.md", adr("0001", { date: "soon" }));
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("docs/adr/0001-a-decision.md:4 adr-date");
    expect(result.stderr).toContain("1 violation");
  });

  it("accepts a root argument", () => {
    seed();
    const result = spawnSync(process.execPath, [script, dir], { cwd: tmpdir(), encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  it("fails when the doc trees are missing", () => {
    rmSync(join(dir, "docs"), { recursive: true });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("ADR index (README.md) not found");
  });
});
