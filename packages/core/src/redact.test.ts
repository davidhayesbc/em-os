import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./redact.js";

test("redacts email addresses and secret assignments", () => {
  assert.equal(redact("Contact alice@example.invalid before the demo."), "Contact [REDACTED-EMAIL] before the demo.");
  assert.equal(redact("token='synthetic-test' is required."), "token='[REDACTED-SECRET]' is required.");
  assert.equal(redact("api_key=\"synthetic-test\""), "api_key=\"[REDACTED-SECRET]\"");
  assert.equal(redact("password=\"test\" is too weak."), "password=\"[REDACTED-SECRET]\" is too weak.");
});

test("redacts multiple occurrences in one string", () => {
  const input = "Email bob@example.invalid and charlie@example.invalid; token=\"test1\" and secret=\"test2\".";
  const output = redact(input);
  assert.doesNotMatch(output, /bob@example\.invalid/);
  assert.doesNotMatch(output, /charlie@example\.invalid/);
  assert.doesNotMatch(output, /test1/);
  assert.doesNotMatch(output, /test2/);
  assert.equal(output, "Email [REDACTED-EMAIL] and [REDACTED-EMAIL]; token=\"[REDACTED-SECRET]\" and secret=\"[REDACTED-SECRET]\".");
});

test("fails closed on non-string input", () => {
  assert.throws(() => redact(undefined as unknown as string), /redact input must be a string/);
  assert.throws(() => redact(123 as unknown as string), /redact input must be a string/);
});

test("leaves ordinary work text unchanged", () => {
  const text = "Plan the synthetic launch checklist and confirm the rollout date.";
  assert.equal(redact(text), text);
});
