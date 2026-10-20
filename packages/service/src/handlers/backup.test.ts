import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, httpTransport } from "@emos/api-contract";
import { openDb } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, startTestService, tmpDir } from "../test-helpers.js";

afterEach(cleanup);

async function setup() {
  const svc = await startTestService();
  const client = createClient({
    transport: httpTransport(`http://127.0.0.1:${svc.port}`),
    token: svc.token,
  });
  return { svc, client };
}

describe("backup.create", () => {
  it("writes a database copy that openDb can open", async () => {
    const { client } = await setup();
    const dest = join(tmpDir(), "nested", "copy.db");
    const out = await client.call("backup.create", { dest });
    expect(out.path).toBe(dest);
    expect(out.bytes).toBe(statSync(dest).size);
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const copy = openDb(dest);
    expect(
      copy.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get<{ n: number }>(),
    ).toBeDefined();
    copy.close();
  });

  it("refuses to overwrite an existing file (conflict)", async () => {
    const { client } = await setup();
    const dest = join(tmpDir(), "exists.db");
    writeFileSync(dest, "precious");
    await expect(client.call("backup.create", { dest })).rejects.toMatchObject({
      code: "conflict",
    });
  });

  it("refuses a destination inside a git checkout", async () => {
    const { client } = await setup();
    const repo = mkdtempSync(join(tmpdir(), "emos repo "));
    mkdirSync(join(repo, ".git"));
    const dest = join(repo, "sub", "copy.db");
    await expect(client.call("backup.create", { dest })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(existsSync(dest)).toBe(false);
  });

  it("rejects a relative destination", async () => {
    const { client } = await setup();
    await expect(client.call("backup.create", { dest: "rel/copy.db" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("leaves no temporary files beside the backup", async () => {
    const { client } = await setup();
    const dir = join(tmpDir(), "out");
    await client.call("backup.create", { dest: join(dir, "copy.db") });
    expect(readdirSync(dir)).toEqual(["copy.db"]);
  });

  it.skipIf(process.platform === "win32")(
    "a dangling symlink at dest counts as existing (conflict) and is not followed",
    async () => {
      const { client } = await setup();
      const dir = tmpDir();
      const target = join(dir, "missing-target.db");
      const dest = join(dir, "link.db");
      symlinkSync(target, dest);
      await expect(client.call("backup.create", { dest })).rejects.toMatchObject({
        code: "conflict",
      });
      expect(existsSync(target)).toBe(false);
      expect(readdirSync(dir).sort()).toEqual(["link.db"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a destination that reaches a git checkout through a symlink",
    async () => {
      const { client } = await setup();
      const repo = mkdtempSync(join(tmpdir(), "emos repo "));
      mkdirSync(join(repo, ".git"));
      mkdirSync(join(repo, "sub"));
      const link = join(tmpDir(), "link");
      symlinkSync(join(repo, "sub"), link);
      for (const dest of [join(link, "copy.db"), join(link, "new", "copy.db")]) {
        await expect(client.call("backup.create", { dest })).rejects.toMatchObject({
          code: "invalid_input",
        });
      }
      expect(readdirSync(join(repo, "sub"))).toEqual([]);
    },
  );
});
