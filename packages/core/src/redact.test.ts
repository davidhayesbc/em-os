import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./redact.js";

test("redacts email addresses and secret assignments", () => {
  assert.equal(redact("Contact alice@example.invalid before the demo."), "Contact [REDACTED-EMAIL] before the demo.");
  assert.equal(redact("token='example-sec-1' is required."), "token='[REDACTED-SECRET]' is required.");
  assert.equal(redact("api_key=\"example-sec-1\""), "api_key=\"[REDACTED-SECRET]\"");
  assert.equal(redact("password=\"example-sec-1\" is too weak."), "password=\"[REDACTED-SECRET]\" is too weak.");
  assert.equal(redact("password=example-sec-2"), "password=[REDACTED-SECRET]");
  assert.equal(redact("token: example-sec-6"), "token: [REDACTED-SECRET]");
  assert.equal(redact("client_secret=`example-sec-3`"), "client_secret=`[REDACTED-SECRET]`");
});

test("redacts prefixed credential keys", () => {
  assert.equal(redact("db_password=\"example-sec-1\""), "db_password=\"[REDACTED-SECRET]\"");
  assert.equal(redact("aws_secret_access_key='example-sec-2'"), "aws_secret_access_key='[REDACTED-SECRET]'");
  assert.equal(redact("github_token=`example-sec-3`"), "github_token=`[REDACTED-SECRET]`");
  assert.equal(redact("x-api-key=example-sec-4"), "x-api-key=[REDACTED-SECRET]");
  assert.equal(redact("stripe_secret=\"example-sec-5\""), "stripe_secret=\"[REDACTED-SECRET]\"");
});

test("redacts multiple occurrences in one string", () => {
  const input = "Email bob@example.invalid and charlie@example.invalid; token=\"example-sec-4\" and secret=\"example-sec-5\".";
  const output = redact(input);
  assert.doesNotMatch(output, /bob@example\.invalid/);
  assert.doesNotMatch(output, /charlie@example\.invalid/);
  assert.doesNotMatch(output, /example-sec-4/);
  assert.doesNotMatch(output, /example-sec-5/);
  assert.equal(output, "Email [REDACTED-EMAIL] and [REDACTED-EMAIL]; token=\"[REDACTED-SECRET]\" and secret=\"[REDACTED-SECRET]\".");
});

test("leaves placeholder and short secret assignments unchanged", () => {
  assert.equal(redact("token='synthetic-test'"), "token='synthetic-test'");
  assert.equal(redact("api_key=\"test\""), "api_key=\"test\"");
  assert.equal(redact("password=abc"), "password=abc");
  assert.equal(redact("secret=redacted"), "secret=redacted");
  assert.equal(redact("db_password=abc"), "db_password=abc");
  assert.equal(redact("github_token='test'"), "github_token='test'");
  assert.equal(redact("aws_secret_access_key=\"redacted\""), "aws_secret_access_key=\"redacted\"");
});

test("does not treat placeholder substrings inside real secrets as placeholders", () => {
  assert.equal(redact("password=attest-secret"), "password=[REDACTED-SECRET]");
  assert.equal(redact("token=example-key-1"), "token=[REDACTED-SECRET]");
  assert.equal(redact("token=synthetic-key-1"), "token=[REDACTED-SECRET]");
});

test("leaves ordinary prose and non-credential words unchanged", () => {
  const text = "Plan the synthetic launch checklist and confirm the rollout date.";
  assert.equal(redact(text), text);
  assert.equal(redact("the password is rotated monthly"), "the password is rotated monthly");
  assert.equal(redact("nottoken='synthetic'"), "nottoken='synthetic'");
  assert.equal(redact("mytoken=abc"), "mytoken=abc");
});

test("fails closed on non-string input", () => {
  assert.throws(() => redact(undefined as unknown as string), /redact input must be a string/);
  assert.throws(() => redact(123 as unknown as string), /redact input must be a string/);
});
