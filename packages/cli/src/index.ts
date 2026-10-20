// @emos/cli: the `emos` command line. Commands implement `Command`; see commands/index.ts.
export { runCli } from "./cli.js";
export { type Command, type CommandIo, EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./command.js";
export { commands } from "./commands/index.js";
