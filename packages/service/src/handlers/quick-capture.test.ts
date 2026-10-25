import { createClient, httpTransport } from "@emos/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, startTestService } from "../test-helpers.js";

const personInput = (displayName: string, aliases: string[] = []) => ({
  displayName,
  relationship: "peer" as const,
  pronouns: null,
  aliases,
  role: null,
  timeZone: null,
  archived: false,
  oneOnOneCadenceDays: null,
});

afterEach(cleanup);

async function setup() {
  const svc = await startTestService();
  const client = createClient({
    transport: httpTransport(`http://127.0.0.1:${svc.port}`),
    token: svc.token,
  });
  await client.call("settings.update", { patch: { displayTimeZone: "America/Los_Angeles" } });
  return client;
}

describe("commitments.quickCapture API", () => {
  it("requires setup before capturing", async () => {
    const client = await setup();
    await expect(client.call("commitments.quickCapture", { text: "Send update" })).resolves.toEqual({
      status: "invalid",
      message: "Finish setup first",
    });
  });

  it("returns every candidate when person resolution is ambiguous", async () => {
    const client = await setup();
    const self = await client.call("people.create", personInput("Alex Rivera"));
    const samChen = await client.call("people.create", personInput("Sam Chen", ["Sam"]));
    const samRivera = await client.call("people.create", personInput("Samuel Rivera", ["Sam"]));
    await client.call("settings.update", { patch: { selfPersonId: self.id } });

    const result = await client.call("commitments.quickCapture", {
      text: "Send hiring feedback @sam !fri !p1 #hiring",
    });

    expect(result).toMatchObject({
      status: "needs_person",
      parsed: { title: "Send hiring feedback", personQuery: "sam", priority: 1, tags: ["hiring"] },
    });
    if (result.status !== "needs_person") throw new Error("Expected person choice");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([samChen.id, samRivera.id]);
  });

  it("returns needs_person with no candidates for an unmatched query", async () => {
    const client = await setup();
    const self = await client.call("people.create", personInput("Alex Rivera"));
    await client.call("settings.update", { patch: { selfPersonId: self.id } });

    await expect(
      client.call("commitments.quickCapture", { text: "Send update @nobody" }),
    ).resolves.toMatchObject({ status: "needs_person", candidates: [] });
  });

  it("creates an active audited user commitment when counterpartId is explicit", async () => {
    const client = await setup();
    const self = await client.call("people.create", personInput("Alex Rivera"));
    const sam = await client.call("people.create", personInput("Sam Chen", ["Sam"]));
    await client.call("settings.update", { patch: { selfPersonId: self.id } });

    const result = await client.call("commitments.quickCapture", {
      text: "Send hiring feedback @sam !fri !p1 #hiring",
      counterpartId: sam.id,
    });

    expect(result).toMatchObject({
      status: "created",
      commitment: {
        title: "Send hiring feedback",
        status: "active",
        createdBy: "user",
        ownerId: self.id,
        counterpartId: sam.id,
        priority: 1,
        tags: ["hiring"],
      },
    });
    if (result.status !== "created") throw new Error("Expected created commitment");
    const fetched = await client.call("commitments.get", { id: result.commitment.id });
    expect(fetched.audit).toEqual([
      expect.objectContaining({ action: "create", actor: "user" }),
    ]);
  });

  it("reports an empty parsed title as invalid", async () => {
    const client = await setup();
    const self = await client.call("people.create", personInput("Alex Rivera"));
    await client.call("settings.update", { patch: { selfPersonId: self.id } });

    await expect(client.call("commitments.quickCapture", { text: "@sam !p1" })).resolves.toEqual({
      status: "invalid",
      message: "A title is required",
    });
  });
});
