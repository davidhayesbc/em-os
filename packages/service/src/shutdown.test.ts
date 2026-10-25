import { existsSync } from "node:fs";
import { createClient, httpTransport } from "@emos/api-contract";
import { afterEach, describe, expect, it } from "vitest";
import { runtimePaths } from "./config.js";
import { cleanup, request, startTestService } from "./test-helpers.js";

afterEach(cleanup);

describe("service.shutdown", () => {
  it("answers { ok: true }, then stops gracefully (lock and service.json removed)", async () => {
    let shutdowns = 0;
    const svc = await startTestService({ onShutdown: () => shutdowns++ });
    const client = createClient({
      transport: httpTransport(`http://127.0.0.1:${svc.port}`),
      token: svc.token,
    });
    await expect(client.call("service.shutdown", { pid: process.pid + 1 })).rejects.toMatchObject({
      code: "conflict",
    });
    await expect(client.call("service.shutdown", { pid: process.pid })).resolves.toEqual({
      ok: true,
    });
    const paths = runtimePaths(svc.dataDir);
    for (let i = 0; i < 100 && (existsSync(paths.lock) || shutdowns === 0); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(existsSync(paths.lock)).toBe(false);
    expect(existsSync(paths.serviceJson)).toBe(false);
    expect(shutdowns).toBe(1);
    // It no longer listens.
    await expect(request(svc.port, { method: "GET", path: "/health/ping" })).rejects.toThrow();
  });

  it("requires the bearer token like every op", async () => {
    const svc = await startTestService();
    const res = await request(svc.port, {
      path: "/rpc/service.shutdown",
      headers: { "x-emos-api": "1", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(existsSync(runtimePaths(svc.dataDir).lock)).toBe(true);
  });
});
