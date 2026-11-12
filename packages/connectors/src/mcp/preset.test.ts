import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { Preset } from "./preset.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePresetPath = join(
  __dirname,
  "..",
  "..",
  "fixtures",
  "presets",
  "example-calendar.yaml",
);

describe("Preset", () => {
  it("validates the shipped example-calendar preset", () => {
    const text = readFileSync(fixturePresetPath, "utf8");
    const parsed = parse(text) as unknown;
    const preset = Preset.parse(parsed);

    expect(preset.preset).toBe("example-calendar");
    expect(preset.server).toBe("example-server");
    expect(preset.capabilities["calendar.listEvents"]).toEqual({
      tool: "list_events",
      args: { start: "{{timeMin}}", end: "{{timeMax}}", page: "{{cursor}}" },
      result: {
        items: "$.events[*]",
        nextCursor: "$.next",
        fields: {
          externalId: "id",
          title: "summary",
          start: "start.dateTime|start.date",
          end: "end.dateTime|end.date",
          attendees: "attendees",
          url: "htmlLink",
          status: "status",
          recurringEventId: "recurringEventId",
        },
      },
    });
  });

  it("rejects a preset with missing required fields", () => {
    expect(() =>
      Preset.parse({
        preset: "incomplete",
        capabilities: {},
      }),
    ).toThrow();
  });
});
