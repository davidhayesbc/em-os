import { describe, expect, it, vi } from "vitest";
import type { Transport } from "./client.js";
import { createClient, httpTransport } from "./client.js";
import { ApiError } from "./errors.js";

function fakeTransport(response: { status: number; json: unknown }) {
  const post = vi.fn<Transport["post"]>(async () => response);
  return { post } satisfies Transport;
}

const healthResult = {
  apiVersion: 1,
  serviceVersion: "0.0.0",
  startedAt: "2026-10-20T16:00:00.000Z",
  dataDir: "/data/em-os",
  secretStore: "keychain",
  connectors: [],
};

describe("createClient", () => {
  it("unwraps ok results", async () => {
    const t = fakeTransport({ status: 200, json: { ok: true, result: healthResult } });
    await expect(
      createClient({ transport: t, token: "k" }).call("health.get", {}),
    ).resolves.toEqual(healthResult);
  });

  it("throws ApiError with the server's code on ok:false", async () => {
    const t = fakeTransport({
      status: 401,
      json: { ok: false, error: { code: "unauthorized", message: "x" } },
    });
    const p = createClient({ transport: t, token: "k" }).call("health.get", {});
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ code: "unauthorized", message: "x" });
  });

  it("sends bearer and api version headers to /rpc/<name>", async () => {
    const t = fakeTransport({ status: 200, json: { ok: true, result: healthResult } });
    await createClient({ transport: t, token: "k" }).call("health.get", {});
    expect(t.post).toHaveBeenCalledTimes(1);
    const [path, body, headers] = t.post.mock.calls[0] ?? [];
    expect(path).toBe("/rpc/health.get");
    expect(body).toEqual({});
    expect(headers?.Authorization).toBe("Bearer k");
    expect(headers?.["X-EMOS-API"]).toBe("1");
  });

  it.each([
    ["null body", null],
    ["undefined body (non-JSON)", undefined],
    ["a string", "oops"],
    ["missing ok", { result: 1 }],
    ["ok:true without result", { ok: true }],
    ["ok:false without error", { ok: false }],
    ["ok:false with a non-string code", { ok: false, error: { code: 5, message: "m" } }],
    ["ok:false with a non-string message", { ok: false, error: { code: "conflict", message: 1 } }],
  ])("throws ApiError(internal) on a malformed body: %s", async (_label, json) => {
    const t = fakeTransport({ status: 200, json });
    await expect(
      createClient({ transport: t, token: "k" }).call("health.get", {}),
    ).rejects.toMatchObject({ name: "ApiError", code: "internal" });
  });

  it("maps an unknown server error code to internal, keeping the message", async () => {
    const t = fakeTransport({
      status: 500,
      json: { ok: false, error: { code: "teapot", message: "short and stout" } },
    });
    await expect(
      createClient({ transport: t, token: "k" }).call("health.get", {}),
    ).rejects.toMatchObject({ code: "internal", message: "short and stout" });
  });

  it("propagates transport ApiErrors unchanged", async () => {
    const t: Transport = {
      post: async () => {
        throw new ApiError("unavailable", "down");
      },
    };
    await expect(
      createClient({ transport: t, token: "k" }).call("health.get", {}),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("httpTransport", () => {
  function fakeFetch(res: Response | Error) {
    return vi.fn<typeof fetch>(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
  }

  it("posts JSON to baseUrl + path and returns status and json", async () => {
    const f = fakeFetch(Response.json({ ok: true, result: 1 }, { status: 200 }));
    const t = httpTransport("http://127.0.0.1:4000", f);
    const r = await t.post("/rpc/health.get", { a: 1 }, { Authorization: "Bearer k" });
    expect(r).toEqual({ status: 200, json: { ok: true, result: 1 } });
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:4000/rpc/health.get");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"a":1}');
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer k");
  });

  it("tolerates a trailing slash on the base url", async () => {
    const f = fakeFetch(Response.json({}));
    await httpTransport("http://127.0.0.1:4000/", f).post("/rpc/x", {}, {});
    expect(f.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4000/rpc/x");
  });

  it("returns undefined json for a non-JSON body", async () => {
    const f = fakeFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    const r = await httpTransport("http://127.0.0.1:4000", f).post("/rpc/x", {}, {});
    expect(r).toEqual({ status: 502, json: undefined });
  });

  it("maps a network failure to ApiError(unavailable)", async () => {
    const f = fakeFetch(new TypeError("fetch failed"));
    await expect(
      httpTransport("http://127.0.0.1:4000", f).post("/rpc/x", {}, {}),
    ).rejects.toMatchObject({ name: "ApiError", code: "unavailable" });
  });

  it("composes with createClient: non-JSON response becomes internal", async () => {
    const f = fakeFetch(new Response("nope", { status: 500 }));
    const client = createClient({
      transport: httpTransport("http://127.0.0.1:4000", f),
      token: "k",
    });
    await expect(client.call("health.get", {})).rejects.toMatchObject({ code: "internal" });
  });
});
