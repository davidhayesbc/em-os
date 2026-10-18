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
  assert.equal(redact("db_password: example_value3"), "db_password: [REDACTED-SECRET]");
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
  assert.equal(redact("Key: takeaways from the meeting"), "Key: takeaways from the meeting");
  assert.equal(redact("The key: performance and reliability"), "The key: performance and reliability");
  assert.equal(redact("key=value12345"), "key=value12345");
});

test("treats prefixed key identifiers conservatively as secret-like", () => {
  // Any `key` preceded by an identifier prefix is treated as a credential key.
  // This is intentionally conservative: it catches `aws_secret_access_key`
  // and `private_key`, but also redacts common non-credential `_key` names.
  assert.equal(redact("sort_key=example_value1"), "sort_key=[REDACTED-SECRET]");
  assert.equal(redact("public_key=example_value2"), "public_key=[REDACTED-SECRET]");
  assert.equal(redact("private_key=example_value4"), "private_key=[REDACTED-SECRET]");
});

test("fails closed on non-string input", () => {
  assert.throws(() => redact(undefined as unknown as string), /redact input must be a string/);
  assert.throws(() => redact(123 as unknown as string), /redact input must be a string/);
});

test("remains linear and unchanged on long separator-dense runs without a keyword", () => {
  const separatorDense = "a.".repeat(6000); // 12,000 characters
  assert.equal(redact(separatorDense), separatorDense);
  const slashDense = "a/".repeat(6000);
  assert.equal(redact(slashDense), slashDense);
  // Generous wall-clock bound: the fix should be well under 10 ms for 12k chars.
  const start = performance.now();
  redact(separatorDense);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 10, `separator-dense redact took ${elapsed.toFixed(2)} ms`);
});

test("remains linear on '@'-bearing separator-dense input", () => {
  // An '@' forces the email regex to run.  A zero-width lookbehind start boundary
  // keeps redaction linear and prevents partial suffix matches on long local parts.
  const prefix = "bob@example.invalid ";
  const separatorDense12k = prefix + "a.".repeat(6000); // ~12,020 characters
  assert.equal(redact(separatorDense12k), "[REDACTED-EMAIL] " + "a.".repeat(6000));

  // Long local parts must still be fully redacted (no partial suffix match).
  assert.equal(redact("a".repeat(65) + "@example.com"), "[REDACTED-EMAIL]");
  assert.equal(redact("abcdefgh.".repeat(10) + "xyz@example.com"), "[REDACTED-EMAIL]");

  const start12k = performance.now();
  redact(separatorDense12k);
  const elapsed12k = performance.now() - start12k;
  assert.ok(elapsed12k < 10, `12k @-bearing separator-dense redact took ${elapsed12k.toFixed(2)} ms`);

  const separatorDense24k = prefix + "a.".repeat(12000);
  const start24k = performance.now();
  redact(separatorDense24k);
  const elapsed24k = performance.now() - start24k;
  assert.ok(elapsed24k < 20, `24k @-bearing separator-dense redact took ${elapsed24k.toFixed(2)} ms`);

  const separatorDense48k = prefix + "a.".repeat(24000);
  const start48k = performance.now();
  redact(separatorDense48k);
  const elapsed48k = performance.now() - start48k;
  assert.ok(elapsed48k < 40, `48k @-bearing separator-dense redact took ${elapsed48k.toFixed(2)} ms`);
});
