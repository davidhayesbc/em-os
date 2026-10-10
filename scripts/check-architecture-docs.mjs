import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../docs/architecture/", import.meta.url);
const files = (await readdir(root)).filter((name) => /^\d{4}-.+\.md$/.test(name)).sort();
const errors = [];

if (files.length === 0) errors.push("no ADR files found");

const index = await readFile(new URL("README.md", root), "utf8");
const expected = files.map((name) => name.slice(0, 4));
const actual = files.map((name) => name.slice(0, 4));
for (let i = 0; i < actual.length; i += 1) {
  const wanted = String(i + 1).padStart(4, "0");
  if (actual[i] !== wanted) errors.push(`${files[i]}: expected sequence ${wanted}`);
}

const required = [
  "## Context",
  "## Decision",
  "## Alternatives considered",
  "## Consequences",
  "## Test implications",
];
for (const name of files) {
  const text = await readFile(new URL(name, root), "utf8");
  for (const heading of required) {
    if (!text.includes(heading)) errors.push(`${name}: missing ${heading}`);
  }
  if (!/Spec: `docs\/PRODUCT_SPEC\.md` §§?/.test(text)) {
    errors.push(`${name}: missing PRODUCT_SPEC section citation`);
  }
  if (!index.includes(`(${name})`)) errors.push(`${name}: missing from architecture index`);
}

const gates = await readFile(new URL("GATES.md", root), "utf8");
for (const gate of [
  "G-RT-01",
  "G-DB-01",
  "G-MCP-01",
  "G-MODEL-01",
  "G-PATH-01",
  "G-SEC-01",
  "G-SEC-02",
  "G-SEARCH-01",
  "G-SKILL-01",
]) {
  const line = gates.split("\n").find((candidate) => candidate.startsWith(`| ${gate} `));
  if (!line) errors.push(`GATES.md: missing ${gate}`);
  else if (line.split("|").length < 7) errors.push(`GATES.md: ${gate} lacks owner/evidence/unblock columns`);
}

if (expected.length !== new Set(expected).size) errors.push("duplicate ADR number");

if (errors.length > 0) {
  console.error(`Architecture documentation check failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Architecture documentation check passed: ${files.length} ADRs and 9 explicit gates.`);
