import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConnectorError } from "./errors.js";
import { fixtureInvoker } from "./fixture-invoker.js";

describe("fixtureInvoker", () => {
  it("returns successive responses per capability", async () => {
    const invoker = fixtureInvoker({
      "cal.list": [{ events: ["a"] }, { events: ["b"] }],
    });
    const schema = z.object({ events: z.array(z.string()) });

    const first = await invoker.call("cal.list", {}, schema);
    const second = await invoker.call("cal.list", {}, schema);

    expect(first).toEqual({ events: ["a"] });
    expect(second).toEqual({ events: ["b"] });
  });

  it("throws schema when the response does not match", async () => {
    const invoker = fixtureInvoker({ cal: [{ notEvents: [] }] });
    await expect(
      invoker.call("cal", {}, z.object({ events: z.array(z.string()) })),
    ).rejects.toBeInstanceOf(ConnectorError);
  });

  it("throws config when responses are exhausted", async () => {
    const invoker = fixtureInvoker({ cal: [{ ok: true }] });
    const schema = z.object({ ok: z.boolean() });
    await invoker.call("cal", {}, schema);
    await expect(invoker.call("cal", {}, schema)).rejects.toBeInstanceOf(ConnectorError);
  });
});
