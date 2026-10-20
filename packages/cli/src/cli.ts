import { type Command, type CommandIo, EXIT_FAILURE, EXIT_USAGE } from "./command.js";

function usage(commands: Command[]): string {
  const width = Math.max(0, ...commands.map((c) => c.name.length));
  const rows = commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`);
  return `Usage: emos <command> [options]\n\nCommands:\n${rows.join("\n")}\n`;
}

/** Dispatches `argv` (without node and the script) to a command and returns its exit code. */
export async function runCli(argv: string[], io: CommandIo, commands: Command[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "--help" || name === "-h") {
    io.out(usage(commands));
    return EXIT_USAGE;
  }
  const command = commands.find((c) => c.name === name);
  if (!command) {
    io.err(`Unknown command: ${name}\n${usage(commands)}`);
    return EXIT_USAGE;
  }
  try {
    return await command.run(rest, io);
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return EXIT_FAILURE;
  }
}
