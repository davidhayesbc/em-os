import { realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import {
  ApiError,
  createClient,
  defineOp,
  type ErrorCode,
  httpTransport,
} from "@emos/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ServiceContext } from "./context.js";
import { type AnyHandler, dispatchRpc, statusForCode } from "./rpc.js";
import { authHeaders, cleanup, request, spyLogger, startTestService } from "./test-helpers.js";

afterEach(cleanup);

const echo = defineOp({
  name: "test.echo",
  input: z.object({ text: z.string(), nested: z.object({ n: z.number() }).optional() }),
  output: z.object({ length: z.number() }),
});
const testOps = { "test.echo": echo };

function fakeCtx() {
  const log = spyLogger();
  return { ctx: { log } as unknown as ServiceContext, log };
}

async function dispatch(body: string, handler: AnyHandler, opts: { op?: string } = {}) {
  const { ctx, log } = fakeCtx();
  const res = await dispatchRpc(ctx, opts.op ?? "test.echo", body, {
    ops: testOps,
    handlers: { "test.echo": handler },
  });
  return { ...res, log };
}

const okHandler: AnyHandler = (_ctx, input) => ({
  length: (input as { text: string }).text.length,
});

async function sendOversizedBodyInTwoParts(
  port: number,
  token: string,
  chunked: boolean,
): Promise<{ responseBeforeUploadFinished: boolean; status: number; json: unknown }> {
  const first = Buffer.alloc(1024 * 1024 + 1, "x");
  const second = Buffer.from("x");
  let uploadFinished = false;
  let responseBeforeUploadFinished = false;

  const response = new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const headers = authHeaders(token);
    if (!chunked) headers["content-length"] = String(first.length + second.length);
    const req = httpRequest(
      { host: "127.0.0.1", port, method: "POST", path: "/rpc/health.get", headers },
      (res) => {
        if (!uploadFinished) responseBeforeUploadFinished = true;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            json: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(first);
    setTimeout(() => {
      uploadFinished = true;
      req.end(second);
    }, 50);
  });

  const result = await response;
  return { responseBeforeUploadFinished, ...result };
}

describe("dispatchRpc", () => {
  it("validates input, calls the handler with parsed input and wraps the result", async () => {
    const res = await dispatch(JSON.stringify({ text: "héllo" }), okHandler);
    expect(res).toMatchObject({ status: 200, body: { ok: true, result: { length: 5 } } });
  });

  it("unknown op → 404 not_found", async () => {
    const res = await dispatch("{}", okHandler, { op: "nope.nothing" });
    expect(res).toMatchObject({ status: 404, body: { ok: false, error: { code: "not_found" } } });
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "does not resolve inherited property %s as an op",
    async (op) => {
      const res = await dispatch("{}", okHandler, { op });
      expect(res.status).toBe(404);
    },
  );

  it("an op without a handler → 404 not_found", async () => {
    const { ctx } = fakeCtx();
    const res = await dispatchRpc(ctx, "test.echo", "{}", {
      ops: testOps,
      handlers: {},
    });
    expect(res).toMatchObject({ status: 404, body: { ok: false, error: { code: "not_found" } } });
  });

  it.each(["", "not json", "{", "{'a':1}"])("non-JSON body %j → 400 invalid_input", async (b) => {
    const res = await dispatch(b, okHandler);
    expect(res).toMatchObject({
      status: 400,
      body: { ok: false, error: { code: "invalid_input" } },
    });
  });

  it("schema failure → 400 invalid_input naming the paths but not the values", async () => {
    const secretish = "SENTINEL-VALUE-123";
    const res = await dispatch(JSON.stringify({ text: 42, nested: { n: secretish } }), okHandler);
    expect(res.status).toBe(400);
    const body = res.body as { ok: false; error: { code: ErrorCode; message: string } };
    expect(body.error.code).toBe("invalid_input");
    expect(body.error.message).toContain("text");
    expect(body.error.message).toContain("nested.n");
    expect(body.error.message).not.toContain(secretish);
    expect(body.error.message).not.toContain("42");
  });

  it.each([
    ["unauthorized", 401],
    ["not_found", 404],
    ["invalid_input", 400],
    ["conflict", 409],
    ["unavailable", 503],
    ["incompatible_version", 409],
    ["internal", 500],
  ] as const)("handler ApiError(%s) → %i", async (code, status) => {
    expect(statusForCode(code)).toBe(status);
    const res = await dispatch(JSON.stringify({ text: "x" }), () => {
      throw new ApiError(code, `msg for ${code}`);
    });
    expect(res).toMatchObject({
      status,
      body: { ok: false, error: { code, message: `msg for ${code}` } },
    });
  });

  it("any other thrown error → 500 internal with a generic message; logs only the error name", async () => {
    const res = await dispatch(JSON.stringify({ text: "SENTINEL-BODY" }), () => {
      throw new TypeError("boom with SENTINEL-DETAIL");
    });
    expect(res).toMatchObject({
      status: 500,
      body: { ok: false, error: { code: "internal", message: "Internal error" } },
    });
    const logged = JSON.stringify(res.log.calls);
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("SENTINEL");
  });

  it("an async rejection is handled like a throw", async () => {
    const res = await dispatch(JSON.stringify({ text: "x" }), async () => {
      throw new ApiError("conflict", "busy");
    });
    expect(res).toMatchObject({ status: 409, body: { ok: false, error: { code: "conflict" } } });
  });

  it("output that violates the op's schema → 500 internal when validating", async () => {
    const bad: AnyHandler = () => ({ length: "nope" });
    const res = await dispatch(JSON.stringify({ text: "x" }), bad);
    expect(res).toMatchObject({ status: 500, body: { ok: false, error: { code: "internal" } } });
  });

  it("returns the parsed output: fields outside the op's schema are stripped", async () => {
    const leaky: AnyHandler = () => ({ length: 1, token: "s3cret", nested: { key: "k" } });
    const res = await dispatch(JSON.stringify({ text: "x" }), leaky);
    expect(res).toEqual({ status: 200, body: { ok: true, result: { length: 1 } }, log: res.log });
    expect(JSON.stringify(res.body)).not.toContain("s3cret");
  });

  it("invalid output fails closed: no unparsed data is ever returned", async () => {
    const bad: AnyHandler = () => ({ length: "nope", token: "s3cret" });
    const res = await dispatch(JSON.stringify({ text: "x" }), bad);
    expect(res).toMatchObject({ status: 500, body: { ok: false, error: { code: "internal" } } });
    expect(JSON.stringify(res.body)).not.toContain("s3cret");
  });
});

describe("POST /rpc/:op over HTTP", () => {
  it("serves health.get with a valid token through the real client", async () => {
    const svc = await startTestService();
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });
    const health = await client.call("health.get", {});
    expect(health).toMatchObject({
      apiVersion: 1,
      dataDir: realpathSync(svc.dataDir),
      connectors: [],
    });
    expect(health.serviceVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(health.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("returns the { ok, result } envelope", async () => {
    const svc = await startTestService();
    const res = await request(svc.port, {
      path: "/rpc/health.get",
      headers: authHeaders(svc.token),
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json).toMatchObject({ ok: true, result: { apiVersion: 1 } });
  });

  it("rejects invalid input with invalid_input and unknown ops with not_found", async () => {
    const svc = await startTestService();
    const unknown = await request(svc.port, {
      path: "/rpc/nope.nothing",
      headers: authHeaders(svc.token),
      body: "{}",
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ ok: false, error: { code: "not_found" } });

    const notJson = await request(svc.port, {
      path: "/rpc/health.get",
      headers: authHeaders(svc.token),
      body: "{not json",
    });
    expect(notJson.status).toBe(400);
    expect(notJson.json).toMatchObject({ ok: false, error: { code: "invalid_input" } });

    const wrongShape = await request(svc.port, {
      path: "/rpc/health.get",
      headers: authHeaders(svc.token),
      body: "[1,2]",
    });
    expect(wrongShape.status).toBe(400);
    expect(wrongShape.json).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });

  it.each([false, true])(
    "rejects a body over 1 MiB with 413 invalid_input (chunked: %s)",
    async (chunked) => {
      const svc = await startTestService();
      const body = JSON.stringify({ pad: "x".repeat(1024 * 1024) });
      const res = await request(svc.port, {
        path: "/rpc/health.get",
        headers: authHeaders(svc.token),
        body,
        chunked,
      });
      expect(res.status).toBe(413);
      expect(res.json).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    },
  );

  it.each([false, true])(
    "drains an oversized upload before returning 413 (chunked: %s)",
    async (chunked) => {
      const svc = await startTestService();
      const res = await sendOversizedBodyInTwoParts(svc.port, svc.token, chunked);
      expect(res.responseBeforeUploadFinished).toBe(false);
      expect(res.status).toBe(413);
      expect(res.json).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    },
  );

  it("accepts a body just under 1 MiB", async () => {
    const svc = await startTestService();
    const body = JSON.stringify({ pad: "x".repeat(1024 * 1024 - 20) });
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(1024 * 1024);
    const res = await request(svc.port, {
      path: "/rpc/health.get",
      headers: authHeaders(svc.token),
      body,
    });
    expect(res.status).toBe(200);
  });

  it.each(["GET", "PUT", "DELETE"])("%s /rpc/:op → 404 not_found", async (method) => {
    const svc = await startTestService();
    const res = await request(svc.port, {
      method,
      path: "/rpc/health.get",
      headers: authHeaders(svc.token),
    });
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("logs the op and error code for failures but never the request body", async () => {
    const log = spyLogger();
    const svc = await startTestService({ log });
    await request(svc.port, {
      path: "/rpc/health.get",
      headers: authHeaders(svc.token),
      body: '"SENTINEL-BODY"',
    });
    const logged = JSON.stringify(log.calls);
    expect(logged).toContain("invalid_input");
    expect(logged).not.toContain("SENTINEL");
  });
});
