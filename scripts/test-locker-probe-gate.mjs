#!/usr/bin/env node
// Automated negative gate and schema-drift tests for the Locker discovery probe.
//
// This script is intentionally self-contained: it exercises the probe harness
// as a subprocess, so it validates the real CLI exit codes and sanitized
// output. It also imports the probe's canonicalization helper to prove that
// schema fingerprints detect nested property-type drift.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const probePath = fileURLToPath(new URL("./probes/locker-discovery-probe.mjs", import.meta.url));
const baseFixturePath = fileURLToPath(new URL("../fixtures/security/locker-probe-transport.synthetic.json", import.meta.url));

async function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probePath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      let parsed;
      try {
        parsed = JSON.parse(stdout || stderr);
      } catch {
        parsed = null;
      }
      resolve({ code, stdout, stderr, parsed });
    });
  });
}

function makeApprovedFixture() {
  const dir = mkdtempSync(join(tmpdir(), "locker-probe-gate-"));
  const path = join(dir, "approved-transport.json");
  const fixture = JSON.parse(readFileSync(baseFixturePath, "utf8"));
  fixture.transport.operatorApproved = true;
  writeFileSync(path, JSON.stringify(fixture), "utf8");
  return { dir, path };
}

const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
}

// 1. Offline run still passes with a sanitized summary.
{
  const result = await run(["--offline", "--transport", baseFixturePath]);
  assert(result.code === 0, `offline probe must exit 0, got ${result.code}`);
  assert(result.parsed?.ok === true, "offline probe summary must have ok: true");
  assert(result.parsed?.mode === "offline", "offline probe summary must report mode offline");
  assert(!result.parsed?.transport?.includes("/"), "summary must not contain a filesystem path");
  assert(result.parsed?.transportKind === "in-process-replay", "summary must label the transport kind");
  assert(result.parsed?.note === undefined, "offline summary must not carry a replay-only note");
  assert(result.parsed?.findings.some((f) => f.step === "envelope-extra-field-rejected" && f.ok && f.errorType === "ProbeSchemaError"), "offline probe must reject extra/sensitive record fields via envelope validation");
}

// 2. --live without operator approval must refuse, even if the config is approved.
{
  const { dir, path } = makeApprovedFixture();
  try {
    const result = await run(["--live", "--transport", path]);
    assert(result.code === 2, `config-approved --live without operator flag must exit 2, got ${result.code}`);
    assert(result.parsed?.errorType === "ProbeRefusalError", `config-approved --live without operator flag must emit ProbeRefusalError, got ${result.parsed?.errorType}`);
    assert((result.stderr || result.stdout).includes("no connection"), "refusal output must state that no connection was attempted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 3. --live with operator flag but unapproved config must also refuse.
{
  const result = await run(["--live", "--operator-approved", "--transport", baseFixturePath]);
  assert(result.code === 2, `operator-approved --live without config approval must exit 2, got ${result.code}`);
  assert(result.parsed?.errorType === "ProbeRefusalError", `operator-approved --live without config approval must emit ProbeRefusalError, got ${result.parsed?.errorType}`);
}

// 4. --live with both approvals passes but explicitly labels the run replay-only.
{
  const { dir, path } = makeApprovedFixture();
  try {
    const result = await run(["--live", "--operator-approved", "--transport", path]);
    assert(result.code === 0, `fully approved --live must exit 0, got ${result.code}`);
    assert(result.parsed?.ok === true, "fully approved --live summary must have ok: true");
    assert(result.parsed?.note?.includes("Replay-only"), "fully approved --live summary must disclose replay-only status");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 5. Schema fingerprint drift: two schemas differing only in a nested property type must differ.
{
  const { canonicalJson, fingerprint } = await import("./probes/locker-discovery-probe.mjs");
  const schemaA = {
    type: "object",
    additionalProperties: false,
    properties: { repository: { type: "string" } },
  };
  const schemaB = {
    type: "object",
    additionalProperties: false,
    properties: { repository: { type: "integer" } },
  };
  const printA = fingerprint(schemaA);
  const printB = fingerprint(schemaB);
  assert(printA !== printB, `nested property-type drift must change fingerprint, got ${printA} twice`);
  // Verify the old buggy canonicalizer would have collapsed both to the same value.
  const buggyA = JSON.stringify(schemaA, Object.keys(schemaA).sort());
  const buggyB = JSON.stringify(schemaB, Object.keys(schemaB).sort());
  assert(buggyA === buggyB, "precondition: the old top-key-only canonicalizer produced a collision");
}

if (failures.length) {
  console.error(`locker probe gate tests failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("locker probe gate tests: PASS");
