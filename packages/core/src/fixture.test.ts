import assert from "node:assert/strict";
import test from "node:test";
import { parsePullRequestFixture } from "./fixture";

function syntheticFixture(): unknown {
  return {
    schemaVersion: 1,
    fetchedAt: "2026-10-09T09:00:00.000Z",
    prs: [{
      provider: "synthetic-git",
      repository: "example/project",
      id: "42",
      title: "Synthetic change",
      url: "https://example.invalid/example/project/pull/42",
      author: "Example Author",
      isDraft: false,
      reviewRequestedOfViewer: true,
      ciStatus: "failing",
      ciUpdatedAt: "2026-10-08T08:00:00.000Z",
      updatedAt: "2026-10-09T08:30:00.000Z",
    }],
  };
}

test("accepts a valid synthetic fixture", () => {
  const fixture = parsePullRequestFixture(syntheticFixture());
  assert.equal(fixture.prs.length, 1);
  assert.equal(fixture.prs[0]?.updatedAt, "2026-10-09T08:30:00.000Z");
  assert.equal(fixture.prs[0]?.ciUpdatedAt, "2026-10-08T08:00:00.000Z");
});

test("rejects an invalid updatedAt with the PR index and field", () => {
  const fixture = syntheticFixture() as { prs: Array<Record<string, unknown>> };
  fixture.prs[0]!.updatedAt = "not-a-timestamp";
  assert.throws(() => parsePullRequestFixture(fixture), /Invalid updatedAt at PR 0/);
});

test("rejects an invalid ciUpdatedAt with the PR index and field", () => {
  const fixture = syntheticFixture() as { prs: Array<Record<string, unknown>> };
  fixture.prs[0]!.ciUpdatedAt = "not-a-timestamp";
  assert.throws(() => parsePullRequestFixture(fixture), /Invalid ciUpdatedAt at PR 0/);
});

for (const [description, url, expected] of [
  ["credentials", "https://token:secret@example.invalid/pull/42", /must not contain credentials/],
  ["a query string", "https://example.invalid/pull/42?token=secret", /must not contain a query string/],
  ["a fragment", "https://example.invalid/pull/42#private", /must not contain a fragment/],
] as const) {
  test(`rejects a source URL containing ${description}`, () => {
    const fixture = syntheticFixture() as { prs: Array<Record<string, unknown>> };
    fixture.prs[0]!.url = url;
    assert.throws(() => parsePullRequestFixture(fixture), expected);
  });
}
