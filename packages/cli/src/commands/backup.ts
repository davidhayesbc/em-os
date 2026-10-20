import { resolve } from "node:path";
import { ApiError, createClient, httpTransport } from "@emos/api-contract";
import { type Command, EXIT_FAILURE, EXIT_OK } from "../command.js";
import {
  baseUrl,
  type CliEnv,
  defaultCliEnv,
  guarded,
  parseFlags,
  probeService,
  readToken,
  resolveDataDirFor,
} from "../env.js";

const USAGE = "Usage: emos backup <dest> [--data-dir <path>]";

export function createBackupCommand(deps: { cli?: CliEnv } = {}): Command {
  const cli = deps.cli ?? defaultCliEnv();
  return {
    name: "backup",
    summary: "Write a consistent copy of the database to <dest>",
    run: (args, io) =>
      guarded(USAGE, io, async () => {
        const { values, positionals } = parseFlags(
          args,
          { "data-dir": { type: "string" } },
          { min: 1, max: 1 },
        );
        const dest = resolve(cli.cwd, positionals[0] as string);
        const dataDir = resolveDataDirFor(cli, values["data-dir"]);

        const svc = await probeService(dataDir);
        const token = readToken(dataDir);
        if (svc.state !== "running" || token === null) {
          io.err("error: the service is not running (start it with: emos service start)\n");
          return EXIT_FAILURE;
        }
        try {
          const client = createClient({ transport: httpTransport(baseUrl(svc.info.port)), token });
          const out = await client.call("backup.create", { dest });
          io.out(`Backup written to ${out.path} (${out.bytes} bytes)\n`);
          return EXIT_OK;
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          io.err(`error: ${e.message}\n`);
          return EXIT_FAILURE;
        }
      }),
  };
}

export const backupCommand: Command = createBackupCommand();
