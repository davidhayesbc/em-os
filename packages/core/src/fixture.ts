import type { CiStatus, PullRequestFixture, PullRequestRecord } from "./contracts";

const ciStatuses = new Set<CiStatus>(["passing", "failing", "pending", "unknown"]);
function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Expected non-empty string: ${key}`);
  return value;
}

function requiredTimestamp(record: Record<string, unknown>, key: string, index: number): string {
  const value = requiredString(record, key);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${key} at PR ${index}`);
  return value;
}

function optionalTimestamp(record: Record<string, unknown>, key: string, index: number): string | undefined {
  if (record[key] === undefined) return undefined;
  return requiredTimestamp(record, key, index);
}

export function parsePullRequestFixture(value: unknown): PullRequestFixture {
  if (!value || typeof value !== "object") throw new Error("Fixture must be an object");
  const fixture = value as Record<string, unknown>;
  if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.prs)) throw new Error("Unsupported fixture schema");
  const fetchedAt = requiredString(fixture, "fetchedAt");
  if (!Number.isFinite(Date.parse(fetchedAt))) throw new Error("Invalid fetchedAt");
  const prs = fixture.prs.map((raw, index): PullRequestRecord => {
    if (!raw || typeof raw !== "object") throw new Error(`PR ${index} must be an object`);
    const record = raw as Record<string, unknown>;
    const ciStatus = record.ciStatus;
    if (typeof ciStatus !== "string" || !ciStatuses.has(ciStatus as CiStatus)) throw new Error(`Invalid ciStatus at PR ${index}`);
    if (typeof record.isDraft !== "boolean" || typeof record.reviewRequestedOfViewer !== "boolean") throw new Error(`Invalid booleans at PR ${index}`);
    const url = requiredString(record, "url");
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:") throw new Error(`PR ${index} source URL must use https`);
    if (parsedUrl.username || parsedUrl.password) throw new Error(`PR ${index} source URL must not contain credentials`);
    if (parsedUrl.search) throw new Error(`PR ${index} source URL must not contain a query string`);
    if (parsedUrl.hash) throw new Error(`PR ${index} source URL must not contain a fragment`);
    return {
      provider: requiredString(record, "provider"), repository: requiredString(record, "repository"),
      id: requiredString(record, "id"), title: requiredString(record, "title"), url,
      author: requiredString(record, "author"), isDraft: record.isDraft,
      reviewRequestedOfViewer: record.reviewRequestedOfViewer, ciStatus: ciStatus as CiStatus,
      ciUpdatedAt: optionalTimestamp(record, "ciUpdatedAt", index),
      updatedAt: requiredTimestamp(record, "updatedAt", index),
    };
  });
  return { schemaVersion: 1, fetchedAt, prs };
}
