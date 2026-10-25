import type { Identity, Person } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { resolvePerson } from "./resolve.js";

const at = "2026-10-25T00:00:00.000Z";
const person = (id: string, displayName: string, aliases: string[] = []): Person => ({
  id,
  displayName,
  relationship: "other",
  pronouns: null,
  aliases,
  role: null,
  timeZone: null,
  archived: false,
  oneOnOneCadenceDays: null,
  occurredAt: at,
  capturedAt: at,
  updatedAt: at,
  retentionState: "active",
});
const identity = (id: string, personId: string, handle: string): Identity => ({
  id,
  personId,
  source: "chat",
  handle,
  confirmed: true,
  occurredAt: at,
  capturedAt: at,
  updatedAt: at,
  retentionState: "active",
});

describe("resolvePerson", () => {
  const people = [
    person("per_zoe", "Zoë Quinn"),
    person("per_sam_c", "Sam Chen"),
    person("per_sam_r", "Samuel Rivera", ["Sam"]),
    person("per_alex", "Alex Rivera"),
  ];
  const identities = [identity("id_alex", "per_alex", "@alex")];

  it("matches names case- and accent-insensitively", () => {
    expect(resolvePerson("zoe", people, identities).map((p) => p.id)).toEqual(["per_zoe"]);
  });

  it("returns every ambiguous exact or first-name candidate", () => {
    expect(resolvePerson("sam", people, identities).map((p) => p.id)).toEqual([
      "per_sam_r",
      "per_sam_c",
    ]);
  });

  it("matches an identity handle before trying first-name prefixes", () => {
    expect(resolvePerson("@ALEX", people, identities).map((p) => p.id)).toEqual(["per_alex"]);
  });
});
