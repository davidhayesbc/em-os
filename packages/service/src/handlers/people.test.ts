import { createClient, httpTransport } from "@emos/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, startTestService } from "../test-helpers.js";

afterEach(cleanup);

async function setup() {
  const svc = await startTestService();
  const client = createClient({
    transport: httpTransport(`http://127.0.0.1:${svc.port}`),
    token: svc.token,
  });
  await client.call("settings.update", { patch: { displayTimeZone: "UTC" } });
  return client;
}

const personInput = {
  displayName: "Alex Rivera",
  relationship: "peer" as const,
  pronouns: null,
  aliases: ["Alex"],
  role: "Engineer",
  timeZone: null,
  archived: false,
  oneOnOneCadenceDays: null,
};

describe("people API", () => {
  it("creates, updates, lists and resolves people and identities", async () => {
    const client = await setup();
    const alex = await client.call("people.create", personInput);
    await client.call("people.addIdentity", {
      personId: alex.id,
      source: "chat",
      handle: "@alex",
      confirmed: true,
    });

    expect(await client.call("people.resolve", { query: "@ALEX" })).toEqual([alex]);
    expect(await client.call("people.list", { relationship: ["peer"] })).toEqual([alex]);
    expect(
      await client.call("people.update", { id: alex.id, patch: { role: "Staff engineer" } }),
    ).toMatchObject({ role: "Staff engineer" });
  });

  it("defaults notes to people_sensitive and today's date, with backdated notes first", async () => {
    const client = await setup();
    const alex = await client.call("people.create", personInput);
    const today = new Date().toISOString().slice(0, 10);

    const current = await client.call("personNotes.create", {
      personId: alex.id,
      text: "Current synthetic note",
    });
    await client.call("settings.update", { patch: { displayTimeZone: "America/Los_Angeles" } });
    const old = await client.call("personNotes.create", {
      personId: alex.id,
      text: "Backdated synthetic note",
      date: "2026-09-01",
    });

    expect(current).toMatchObject({ sensitivity: "people_sensitive", origin: "manual" });
    expect(current.occurredAt).toBe(`${today}T00:00:00.000Z`);
    expect(old.occurredAt).toBe("2026-09-01T07:00:00.000Z");
    expect((await client.call("personNotes.list", { personId: alex.id })).map((n) => n.id)).toEqual(
      [old.id, current.id],
    );
    expect((await client.call("people.get", { id: alex.id })).notes).toEqual([old, current]);
  });

  it("returns not_found for an unknown person", async () => {
    const client = await setup();
    await expect(client.call("people.get", { id: "per_missing" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
