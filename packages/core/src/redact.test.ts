import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./redact.js";

test("redacts email addresses and secret assignments", () => {
  assert.equal(redact("Contact alice@example.invalid before the demo."), "Contact [REDACTED-EMAIL] before the demo.");
  assert.equal(redact("token='hunter2xyz123' is required."), "token='[REDACTED-SECRET]' is required.");
  assert.equal(redact("api_key=\"hunter2xyz123\""), "api_key=\"[REDACTED-SECRET]\"");
  assert.equal(redact("password=\"hunter2xyz123\" is too weak."), "password=\"[REDACTED-SECRET]\" is too weak.");
  assert.equal(redact("password=hunter2xyz"), "password=[REDACTED-SECRET]");
  assert.equal(redact("token: abcdef123456"), "token: [REDACTED-SECRET]");
  assert.equal(redact("client_secret=`abcdefgh`"), "client_secret=`[REDACTED-SECRET]`");
});

test("redacts multiple occurrences in one string", () => {
  const input = "Email bob@example.invalid and charlie@example.invalid; token=\"hunter2xyz1\" and secret=\"hunter2xyz2\".";
  const output = redact(input);
  assert.doesNotMatch(output, /bob@example\.invalid/);
  assert.doesNotMatch(output, /charlie@example\.invalid/);
  assert.doesNotMatch(output, /hunter2xyz1/);
  assert.doesNotMatch(output, /hunter2xyz2/);
  assert.equal(output, "Email [REDACTED-EMAIL] and [REDACTED-EMAIL]; token=\"[REDACTED-SECRET]\" and secret=\"[REDACTED-SECRET]\".");
});

test("leaves placeholder and short secret assignments unchanged", () => {
  assert.equal(redact("token='synthetic-test'"), "token='synthetic-test'");
  assert.equal(redact("api_key=\"test\""), "api_key=\"test\"");
  assert.equal(redact("password=abc"), "password=abc");
  assert.equal(redact("secret=redacted"), "secret=redacted");
});

test("does not treat placeholder substrings inside real secrets as placeholders", () => {
  assert.equal(redact("password=attest-actual-secret"), "password=[REDACTED-SECRET]");
  assert.equal(redact("token=example-production-key-123"), "token=[REDACTED-SECRET]");
  assert.equal(redact("token=synthetic-prod-secret-123"), "token=[REDACTED-SECRET]");
});

test("fails closed on non-string input", () => {
  assert.throws(() => redact(undefined as unknown as string), /redact input must be a string/);
  assert.throws(() => redact(123 as unknown as string), /redact input must be a string/);
});

test("leaves ordinary work text unchanged", () => {
  const text = "Plan the synthetic launch checklist and confirm the rollout date.";
  assert.equal(redact(text), text);
});
