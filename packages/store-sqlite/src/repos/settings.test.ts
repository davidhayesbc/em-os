import { DEFAULT_PROFILE, type Profile, type RankConfig } from "@emos/api-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../open.js";
import { createSettingsRepo } from "./settings.js";

let db: ReturnType<typeof openDb>;

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => db.close());

function legacyProfile(): Profile {
  const originalRank = DEFAULT_PROFILE.rank;
  const { staleDays: _staleDays, weights, ...rankRest } = originalRank;
  const { staleSource: _staleSource, ...weightsRest } = weights;
  const rank: RankConfig = { ...rankRest, weights: weightsRest } as RankConfig;
  return { ...DEFAULT_PROFILE, rank };
}

function profileWithOverrides(staleDays: number, staleSource: number): Profile {
  return {
    ...DEFAULT_PROFILE,
    rank: {
      ...DEFAULT_PROFILE.rank,
      staleDays,
      weights: { ...DEFAULT_PROFILE.rank.weights, staleSource },
    },
  };
}

describe("SettingsRepo", () => {
  it("backfills missing rank.staleDays and rank.weights.staleSource with approved defaults", () => {
    const legacy = legacyProfile();
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "profile",
      JSON.stringify(legacy),
    );

    const profile = createSettingsRepo(db).getProfile();

    expect(profile.rank.staleDays).toBe(14);
    expect(profile.rank.weights.staleSource).toBe(60);
    expect(profile.rank.topN).toBe(DEFAULT_PROFILE.rank.topN);
    expect(profile.rank.weights.priority).toEqual(DEFAULT_PROFILE.rank.weights.priority);
  });

  it("preserves explicitly stored staleDays and staleSource values", () => {
    const profile = profileWithOverrides(30, 5);

    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "profile",
      JSON.stringify(profile),
    );

    const loaded = createSettingsRepo(db).getProfile();

    expect(loaded.rank.staleDays).toBe(30);
    expect(loaded.rank.weights.staleSource).toBe(5);
  });
});
