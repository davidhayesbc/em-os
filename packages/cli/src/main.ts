#!/usr/bin/env node
// The `emos` bin: a thin client of the local service.
import { runCli } from "./cli.js";
import { commands } from "./commands/index.js";

process.exitCode = await runCli(
  process.argv.slice(2),
  {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  },
  commands,
);
