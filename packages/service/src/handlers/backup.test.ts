import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, httpTransport } from "@emos/api-contract";
import { openDb } from "@emos/store-sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ServiceContext } from "../context.js";
import { cleanup, startTestService, tmpDir } from "../test-helpers.js";
import { makeBackupCreate, type PublishOps, publishBackup } from "./backup.js";

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

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** Real fs operations with overrides, to force failures. */
function ops(over: Partial<PublishOps> = {}): PublishOps {
  return {
    link: linkSync,
    copyExcl: (src, dest) => copyFileSync(src, dest, 1),
    remove: (p) => rmSync(p, { force: true }),
    ...over,
  };
}

/** A context whose database "backup" writes a small known file. */
function fakeCtx(): ServiceContext {
  return {
    db: { backup: async (to: string) => writeFileSync(to, "snapshot") },
    clock: { now: () => new Date("2026-10-20T16:00:00.000Z") },
  } as unknown as ServiceContext;
}

describe("publishing a backup", () => {
  const FALLBACK_CODES = ["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"];

  it.each(FALLBACK_CODES)(
    "falls back to an exclusive copy when link fails with %s",
    async (code) => {
      const dir = tmpDir();
      const dest = join(dir, "copy.db");
      const handler = makeBackupCreate(
        ops({
          link: () => {
            throw errno(code);
          },
        }),
      );
      const out = await handler(fakeCtx(), { dest });
      expect(readFileSync(dest, "utf8")).toBe("snapshot");
      expect(out).toMatchObject({ path: dest, bytes: 8, createdAt: "2026-10-20T16:00:00.000Z" });
      expect(readdirSync(dir)).toEqual(["copy.db"]); // temp removed
    },
  );

  it("a copy that fails part way (ENOSPC) leaves no dest and no temp", async () => {
    const dir = tmpDir();
    const dest = join(dir, "copy.db");
    const handler = makeBackupCreate(
      ops({
        link: () => {
          throw errno("EPERM");
        },
        copyExcl: (_src, to) => {
          writeFileSync(to, "par"); // partial
          throw errno("ENOSPC");
        },
      }),
    );
    await expect(handler(fakeCtx(), { dest })).rejects.toMatchObject({ code: "ENOSPC" });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("an EEXIST from the copy fallback is a conflict and the existing entry is kept", () => {
    const dir = tmpDir();
    const tmp = join(dir, "tmp");
    const dest = join(dir, "dest");
    writeFileSync(tmp, "new");
    writeFileSync(dest, "theirs");
    expect(() =>
      publishBackup(
        tmp,
        dest,
        ops({
          link: () => {
            throw errno("EPERM");
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "conflict" }));
    expect(readFileSync(dest, "utf8")).toBe("theirs");
  });

  it("other link errors (e.g. EACCES) are not masked by a copy", async () => {
    const dir = tmpDir();
    const handler = makeBackupCreate(
      ops({
        link: () => {
          throw errno("EACCES");
        },
        copyExcl: () => {
          throw new Error("must not copy");
        },
      }),
    );
    await expect(handler(fakeCtx(), { dest: join(dir, "copy.db") })).rejects.toMatchObject({
      code: "EACCES",
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a file appearing after the pre-check (link EEXIST) is a conflict; temp removed, theirs kept", async () => {
    const dir = tmpDir();
    const dest = join(dir, "copy.db");
    const handler = makeBackupCreate(
      ops({
        link: () => {
          writeFileSync(dest, "theirs"); // the race: created between check and publish
          throw errno("EEXIST");
        },
      }),
    );
    await expect(handler(fakeCtx(), { dest })).rejects.toMatchObject({ code: "conflict" });
    expect(readdirSync(dir)).toEqual(["copy.db"]);
    expect(readFileSync(dest, "utf8")).toBe("theirs");
  });
});

describe("backup.create path normalisation", () => {
  it.skipIf(process.platform === "win32")("rejects dest with .. segments", async () => {
    const { client } = await setup();
    const dir = tmpDir();
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "lnk"));
    for (const dest of [`${dir}/lnk/../copy.db`, `${dir}/./copy.db`, `${dir}//copy.db`]) {
      await expect(client.call("backup.create", { dest })).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    expect(readdirSync(dir).sort()).toEqual(["lnk", "real"]);
  });
});
