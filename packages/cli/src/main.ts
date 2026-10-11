#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_SETTINGS, escapeTerminalControls, findPrAttention, localPaths, parsePullRequestFixture } from "@em-os/core";

const safe = escapeTerminalControls;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "paths") {
    console.log(JSON.stringify(localPaths(), null, 2));
    return;
  }
  if (command !== "attention") {
    console.error("Usage: em-os attention --fixture <file> [--now <ISO timestamp>] | em-os paths");
    process.exitCode = 2;
    return;
  }
  const fixtureName = argument("--fixture");
  if (!fixtureName) throw new Error("--fixture is required; network connectors are intentionally unavailable");
  const nowValue = argument("--now");
  const now = nowValue ? new Date(nowValue) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error(`Invalid --now value: ${nowValue}`);
  const fixturePath = resolve(fixtureName);
  const fixture = parsePullRequestFixture(JSON.parse(await readFile(fixturePath, "utf8")) as unknown);
  const candidates = findPrAttention(fixture.prs, { now, ...DEFAULT_SETTINGS });
  const fetchedAge = Math.max(0, Math.floor((now.getTime() - Date.parse(fixture.fetchedAt)) / 60_000));
  console.log(`EM OS synthetic PR attention — fetched ${safe(fixture.fetchedAt)} (${fetchedAge}m ago)`);
  console.log(`Source: ${safe(fixturePath)} (local fixture; no network)`);
  if (candidates.length === 0) console.log("No candidates.");
  for (const item of candidates) {
    console.log(`\n[${safe(item.kind)}] ${safe(item.title)}`);
    console.log(`Reason: ${safe(item.reason)}`);
    console.log(`Freshness: ${safe(item.freshness)}; observed ${safe(item.observedAt)} (${item.ageMinutes}m ago)`);
    console.log(`Source: ${safe(item.source.label)} ${safe(item.source.url)}`);
  }
}

main().catch((error: unknown) => {
  console.error(`em-os: ${safe(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
});
