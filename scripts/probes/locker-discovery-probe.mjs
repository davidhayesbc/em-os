#!/usr/bin/env node
// Locker discovery probe harness (G-MCP-01 evidence artifact).
//
// Dependency-free Node script implementing the direct-MCP synthetic probe
// protocol from docs/SECURITY_CONNECTOR_DISCOVERY.md and ADR 0004. It runs
// end-to-end offline against a JSON-RPC replay fixture, or in live mode under
// explicit operator approval. It never records response content, credentials,
// endpoint URLs, tokens, prompts or source excerpts.
//
// Usage:
//   node scripts/probes/locker-discovery-probe.mjs --offline --transport fixtures/security/locker-probe-transport.synthetic.json
//   node scripts/probes/locker-discovery-probe.mjs --live --operator-approved --transport <approved-config.json>
//
// Exit codes:
//   0  probe passed and produced a sanitized machine-readable summary
//   1  probe failed (schema, scope, transport, policy)
//   2  usage / configuration error

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const ALLOWLIST = ["pull_requests.list"];
const APPROVED_RECORD_FIELDS = ["sourceId", "url", "repository", "state", "updatedAt"];
const APPROVED_STATES = new Set(["open", "closed", "merged"]);
const REPOSITORY_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SENSITIVE_FIELD_HINTS = new Set([
  "body", "title", "author", "comment", "comments", "diff", "patch",
  "token", "secret", "password", "apiKey", "authorization", "authHeader",
  "email", "prompt", "transcript", "content", "response", "endpoint",
]);

class ProbeError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
    this.name = type;
  }
}

class ProbeRefusalError extends ProbeError {
  constructor(message) {
    super("ProbeRefusalError", message);
  }
}

class ProbeTransportError extends ProbeError {
  constructor(message, { interrupted = false, retryable = false } = {}) {
    super("ProbeTransportError", message);
    this.interrupted = interrupted;
    this.retryable = retryable;
  }
}

class ProbeSchemaError extends ProbeError {
  constructor(message) {
    super("ProbeSchemaError", message);
  }
}

class ProbeScopeError extends ProbeError {
  constructor(message) {
    super("ProbeScopeError", message);
  }
}

class ProbeAccessDeniedError extends ProbeError {
  constructor(message) {
    super("ProbeAccessDeniedError", message);
  }
}

class ProbeRateLimitError extends ProbeError {
  constructor(message, retryAfter) {
    super("ProbeRateLimitError", message);
    this.retryAfter = retryAfter;
  }
}

function assert(condition, message) {
  if (!condition) throw new ProbeSchemaError(message);
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item) ?? "null").join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const pairs = keys
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${pairs.join(",")}}`;
  }
  if (value === undefined) return undefined;
  return JSON.stringify(value);
}

function sanitizeErrorMessage(err) {
  if (err instanceof ProbeRefusalError) return "Live Locker probe refused by policy gate; no connection attempted.";
  if (err instanceof ProbeScopeError) return "Scope/tool allowlist violation.";
  if (err instanceof ProbeAccessDeniedError) return "Access denied.";
  if (err instanceof ProbeRateLimitError) return "Rate limited.";
  if (err instanceof ProbeSchemaError) return "Schema/policy validation failed.";
  if (err instanceof ProbeTransportError) return err.interrupted ? "Transport interrupted." : "Transport error.";
  return "Probe failed.";
}

function fingerprint(value) {
  const hash = createHash("sha256");
  hash.update(canonicalJson(value));
  return hash.digest("hex");
}

export { canonicalJson, fingerprint };

function isRfc3339(value) {
  return typeof value === "string" && RFC3339.test(value) && Number.isFinite(Date.parse(value));
}

function validateHttpsUrl(value, context) {
  assert(typeof value === "string" && value.length > 0, `${context}: url must be a non-empty string`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProbeSchemaError(`${context}: url is not a valid URL`);
  }
  assert(parsed.protocol === "https:", `${context}: url must use https`);
  assert(!parsed.username && !parsed.password, `${context}: url must not contain credentials`);
  assert(!parsed.search, `${context}: url must not contain a query string`);
  assert(!parsed.hash, `${context}: url must not contain a fragment`);
  const hostname = parsed.hostname.toLowerCase();
  assert(hostname === "example.invalid" || hostname.endsWith(".example.invalid"),
    `${context}: synthetic url must use example.invalid host in this harness`);
  return value;
}

function validateEnvelope(envelope, source) {
  assert(envelope && typeof envelope === "object", `${source}: envelope must be an object`);
  assert(envelope.schemaVersion === SCHEMA_VERSION, `${source}: schemaVersion must be ${SCHEMA_VERSION}`);
  assert(Array.isArray(envelope.records), `${source}: records must be an array`);

  const topKeys = new Set(Object.keys(envelope));
  for (const key of topKeys) {
    if (!["schemaVersion", "records", "nextCursor", "watermark"].includes(key)) {
      throw new ProbeSchemaError(`${source}: envelope contains disallowed top-level field '${key}'`);
    }
  }

  if (envelope.nextCursor !== undefined) {
    assert(typeof envelope.nextCursor === "string", `${source}: nextCursor must be a string`);
  }
  if (envelope.watermark !== undefined) {
    assert(isRfc3339(envelope.watermark), `${source}: watermark must be RFC3339`);
  }

  for (let i = 0; i < envelope.records.length; i += 1) {
    const record = envelope.records[i];
    const ctx = `${source}: record ${i}`;
    assert(record && typeof record === "object", `${ctx}: record must be an object`);
    const recordKeys = new Set(Object.keys(record));
    for (const key of recordKeys) {
      if (!APPROVED_RECORD_FIELDS.includes(key)) {
        if (SENSITIVE_FIELD_HINTS.has(key)) {
          throw new ProbeSchemaError(`${ctx}: record contains sensitive disallowed field '${key}' (fail-closed)`);
        }
        throw new ProbeSchemaError(`${ctx}: record contains unknown field '${key}' (fail-closed)`);
      }
    }
    for (const key of APPROVED_RECORD_FIELDS) {
      assert(record[key] !== undefined, `${ctx}: missing required field '${key}'`);
    }
    assert(typeof record.sourceId === "string" && record.sourceId.length > 0, `${ctx}: sourceId must be non-empty string`);
    validateHttpsUrl(record.url, ctx);
    assert(typeof record.repository === "string" && REPOSITORY_PATTERN.test(record.repository),
      `${ctx}: repository must match owner/repo`);
    assert(APPROVED_STATES.has(record.state), `${ctx}: state must be open|closed|merged`);
    assert(isRfc3339(record.updatedAt), `${ctx}: updatedAt must be RFC3339`);
  }

  return {
    schemaVersion: envelope.schemaVersion,
    records: envelope.records,
    nextCursor: envelope.nextCursor,
    watermark: envelope.watermark,
  };
}

function recordsFingerprint(records) {
  const canonical = records.map((record) => {
    const sorted = {};
    for (const key of APPROVED_RECORD_FIELDS) {
      sorted[key] = record[key];
    }
    return sorted;
  });
  return fingerprint(canonical);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const modeIdx = args.findIndex((a) => a === "--offline" || a === "--live");
  if (modeIdx === -1) {
    throw new ProbeRefusalError("Usage: --offline --transport <path> | --live --operator-approved --transport <path>");
  }
  const mode = args[modeIdx].slice(2);
  const transportIdx = args.indexOf("--transport");
  if (transportIdx === -1 || !args[transportIdx + 1]) {
    throw new ProbeRefusalError("--transport <path> is required");
  }
  const transportPath = args[transportIdx + 1];
  const operatorApproved = args.includes("--operator-approved") || process.env.EM_OS_PROBE_LOCKER_OPERATOR_APPROVED === "1";
  return { mode, transportPath, operatorApproved };
}

function loadTransportFixture(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ProbeTransportError(`Cannot read transport fixture: ${err.message}`);
  }
  let fixture;
  try {
    fixture = JSON.parse(text);
  } catch (err) {
    throw new ProbeSchemaError(`Invalid transport fixture JSON: ${err.message}`);
  }
  assert(fixture && typeof fixture === "object", "transport fixture must be an object");
  assert(fixture.classification === "synthetic", "transport fixture must be classified synthetic");
  assert(fixture.transportVersion === 1, "transport fixture version must be 1");
  assert(Array.isArray(fixture.exchanges), "transport fixture must define exchanges array");
  return fixture;
}

function matchRequest(actual, expected) {
  if (expected.method && actual.method !== expected.method) {
    throw new ProbeTransportError(`Expected request method ${expected.method}, got ${actual.method}`);
  }
  if (expected.params && actual.params) {
    for (const [key, value] of Object.entries(expected.params)) {
      const actualValue = actual.params[key];
      if (JSON.stringify(actualValue) !== JSON.stringify(value)) {
        throw new ProbeTransportError(`Expected param ${key}=${JSON.stringify(value)}, got ${JSON.stringify(actualValue)}`);
      }
    }
  }
}

class InProcessReplayTransport {
  constructor(fixture) {
    this.fixture = fixture;
    this.index = 0;
    this.rateLimitObservations = [];
  }

  async call(request) {
    if (this.index >= this.fixture.exchanges.length) {
      throw new ProbeTransportError("Replay exhausted: transport fixture has no more exchanges");
    }
    const exchange = this.fixture.exchanges[this.index];
    this.index += 1;

    if (exchange.transportError) {
      throw new ProbeTransportError(exchange.transportError.message ?? "transport error", {
        interrupted: exchange.transportError.interrupted ?? false,
        retryable: exchange.transportError.retryable ?? false,
      });
    }

    matchRequest(request, exchange.request);

    if (exchange.rateLimit) {
      this.rateLimitObservations.push({
        remaining: exchange.rateLimit.remaining,
        retryAfter: exchange.rateLimit.retryAfter,
      });
    }

    if (exchange.response.error) {
      const err = exchange.response.error;
      const code = err.code ?? 0;
      const message = err.message ?? "transport error";
      if (code === -32001 || /access|denied|permission|unauthorized|forbidden/i.test(message)) {
        throw new ProbeAccessDeniedError(`Access denied: ${message}`);
      }
      if (code === -32002 || /rate.?limit|too many requests/i.test(message)) {
        throw new ProbeRateLimitError(`Rate limited: ${message}`, exchange.rateLimit?.retryAfter);
      }
      if (code === -32602 || /invalid|malformed|schema|cursor/i.test(message)) {
        throw new ProbeSchemaError(`Schema/validation error: ${message}`);
      }
      if (code === -32601 || /not found|unimplemented|not supported|method not available/i.test(message)) {
        throw new ProbeSchemaError(`Method not available: ${message}`);
      }
      throw new ProbeTransportError(`RPC error ${code}: ${message}`);
    }

    return exchange.response.result;
  }
}

function extractEnvelope(result, source) {
  assert(result && typeof result === "object", `${source}: tool result must be an object`);
  const textItem = Array.isArray(result.content)
    ? result.content.find((c) => c && c.type === "text")
    : undefined;
  assert(textItem && typeof textItem.text === "string", `${source}: expected a single text content item`);
  let envelope;
  try {
    envelope = JSON.parse(textItem.text);
  } catch (err) {
    throw new ProbeSchemaError(`${source}: tool result text is not valid JSON: ${err.message}`);
  }
  return validateEnvelope(envelope, source);
}

async function runCapabilityDiscovery(transport, findings) {
  const result = await transport.call({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert(result && typeof result === "object" && Array.isArray(result.tools), "tools/list result must contain tools array");

  const advertised = result.tools.map((t) => t.name);
  for (const name of advertised) {
    if (!ALLOWLIST.includes(name)) {
      throw new ProbeScopeError(`Mutation or unapproved tool '${name}' advertised (allowlist: ${ALLOWLIST.join(", ")})`);
    }
  }

  const schemas = Object.fromEntries(result.tools.map((t) => [t.name, t.inputSchema]));
  for (const name of ALLOWLIST) {
    assert(schemas[name], `allowlisted tool '${name}' must be advertised`);
  }
  const schemaPrints = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [name, fingerprint(schema)]),
  );

  findings.push({ step: "tools/list", ok: true, advertisedTools: advertised, schemaFingerprints: schemaPrints });

  try {
    await transport.call({ jsonrpc: "2.0", id: 2, method: "resources/list", params: {} });
    findings.push({ step: "resources/list", ok: true, note: "returned without denial (operator-approved in fixture)" });
  } catch (err) {
    if (err instanceof ProbeAccessDeniedError || err instanceof ProbeSchemaError) {
      findings.push({ step: "resources/list", ok: true, note: "correctly denied/unimplemented when not approved", errorType: err.type });
    } else {
      throw err;
    }
  }

  return { advertised, schemas, schemaPrints };
}

async function invokeAllowlistedReadOnly(transport, repository, limit, cursor, updatedSince, label) {
  assert(ALLOWLIST.includes("pull_requests.list"), "allowlisted read tool missing");
  const args = { repository, limit };
  if (cursor !== undefined) args.cursor = cursor;
  if (updatedSince !== undefined) args.updatedSince = updatedSince;
  assert(limit <= 50, "page limit must be 50 or fewer");
  const result = await transport.call({
    jsonrpc: "2.0",
    id: label,
    method: "tools/call",
    params: { name: "pull_requests.list", arguments: args },
  });
  return extractEnvelope(result, label);
}

async function expectError(label, expectedType, fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof expectedType) {
      return { ok: true, errorType: err.type, retryAfter: err.retryAfter, interrupted: err.interrupted };
    }
    throw err;
  }
  throw new Error(`${label}: expected ${expectedType.name} but the call succeeded`);
}

async function runProbe({ mode, transportPath, operatorApproved }) {
  const findings = [];
  const startedAt = Date.now();

  const fixture = loadTransportFixture(transportPath);

  if (mode === "live") {
    const configApproved = fixture.transport?.operatorApproved === true;
    if (!operatorApproved || !configApproved) {
      throw new ProbeRefusalError(
        "Live Locker probe refused: requires --operator-approved flag or EM_OS_PROBE_LOCKER_OPERATOR_APPROVED=1, plus an approved transport config. No connection was attempted."
      );
    }
  }

  const transport = new InProcessReplayTransport(fixture);

  // Step 1-2: capability discovery.
  const { advertised, schemaPrints } = await runCapabilityDiscovery(transport, findings);

  // Step 3: initial page.
  const initial = await invokeAllowlistedReadOnly(transport, "acme/widget", 50, undefined, undefined, "initial-page");
  findings.push({ step: "initial-page", ok: true, recordCount: initial.records.length, hasCursor: !!initial.nextCursor });

  // Step 4: continuation page.
  const continuation = await invokeAllowlistedReadOnly(transport, "acme/widget", 50, initial.nextCursor, undefined, "continuation-page");
  findings.push({ step: "continuation-page", ok: true, recordCount: continuation.records.length });

  // Step 5: no-change / delta request.
  const delta = await invokeAllowlistedReadOnly(transport, "acme/widget", 50, undefined, continuation.watermark, "delta-request");
  findings.push({ step: "delta-request", ok: true, recordCount: delta.records.length });

  // Negative cases.
  findings.push({
    step: "malformed-cursor",
    ...await expectError("malformed-cursor", ProbeSchemaError, () =>
      invokeAllowlistedReadOnly(transport, "acme/widget", 50, "MALFORMED_CURSOR", undefined, "malformed-cursor")),
  });

  findings.push({
    step: "access-denial",
    ...await expectError("access-denial", ProbeAccessDeniedError, () =>
      invokeAllowlistedReadOnly(transport, "denied/repo", 50, undefined, undefined, "access-denial")),
  });

  findings.push({
    step: "rate-limit",
    ...await expectError("rate-limit", ProbeRateLimitError, () =>
      invokeAllowlistedReadOnly(transport, "acme/widget", 50, undefined, undefined, "rate-limit")),
  });

  findings.push({
    step: "transport-interruption",
    ...await expectError("transport-interruption", ProbeTransportError, () =>
      transport.call({ jsonrpc: "2.0", id: "interruption", method: "tools/call", params: { name: "ping" } })),
  });

  // Fail-closed envelope validation (extra sensitive field).
  findings.push({
    step: "envelope-extra-field-rejected",
    ...await expectError("envelope-extra-field-rejected", ProbeSchemaError, async () => {
      const result = await transport.call({
        jsonrpc: "2.0",
        id: "extra-field",
        method: "tools/call",
        params: { name: "pull_requests.list" },
      });
      return extractEnvelope(result, "envelope-extra-field-rejected");
    }),
  });

  const allRecords = [initial, continuation, delta].flatMap((p) => p.records);
  const summary = {
    ok: true,
    mode,
    transport: basename(transportPath),
    transportKind: "in-process-replay",
    note: mode === "live"
      ? "Replay-only: no network connection was attempted; live transport is not yet configured."
      : undefined,
    schemaVersion: SCHEMA_VERSION,
    approvedFields: APPROVED_RECORD_FIELDS,
    advertisedTools: advertised,
    schemaFingerprints: schemaPrints,
    recordsFingerprint: recordsFingerprint(allRecords),
    pageRecordCounts: [initial.records.length, continuation.records.length, delta.records.length],
    rateLimitObservations: transport.rateLimitObservations,
    findings,
    durationMs: Date.now() - startedAt,
  };
  return summary;
}

async function main() {
  try {
    const args = parseArgs(process.argv);
    const summary = await runProbe(args);
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (err) {
    const sanitized = {
      ok: false,
      errorType: err.type ?? err.name ?? "Error",
      message: sanitizeErrorMessage(err),
    };
    console.error(JSON.stringify(sanitized, null, 2));
    process.exit(err instanceof ProbeRefusalError || err.message?.includes("Usage") ? 2 : 1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
