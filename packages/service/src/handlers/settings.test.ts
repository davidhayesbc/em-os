import { createClient, DEFAULT_PROFILE, httpTransport } from "@emos/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, startTestService } from "../test-helpers.js";

afterEach(cleanup);

async function setup() {
  const svc = await startTestService();
  const client = createClient({
    transport: httpTransport(`http://127.0.0.1:${svc.port}`),
    token: svc.token,
  });
  return { client };
}

describe("settings and layouts", () => {
  it("returns the validated default profile from a fresh store", async () => {
    const { client } = await setup();

    const profile = await client.call("settings.get", {});

    expect(profile).toEqual(DEFAULT_PROFILE);
    expect(profile.onboarded).toBe(false);
  });

  it("deep-merges a working-hours patch without losing sibling fields", async () => {
    const { client } = await setup();

    const profile = await client.call("settings.update", {
      patch: { workingHours: { start: "08:30" } },
    });

    expect(profile.workingHours).toEqual({ start: "08:30", end: "17:00" });
    expect(profile.rank).toEqual(DEFAULT_PROFILE.rank);
    expect(await client.call("settings.get", {})).toEqual(profile);
  });

  it("rejects an invalid display time zone as invalid_input", async () => {
    const { client } = await setup();

    await expect(
      client.call("settings.update", { patch: { displayTimeZone: "Mars/Base" } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("round-trips a layout", async () => {
    const { client } = await setup();
    const layout = [
      { widgetId: "do-these-5", w: 2, h: 3 },
      { widgetId: "week-load", w: 1, h: 1 },
    ];

    expect(await client.call("layout.get", { surface: "dashboard" })).toBeNull();
    expect(await client.call("layout.set", { surface: "dashboard", layout })).toEqual(layout);
    expect(await client.call("layout.get", { surface: "dashboard" })).toEqual(layout);
  });
});
