export interface CommandIo {
  out(s: string): void;
  err(s: string): void;
}

/** Exit codes: 0 ok, 1 failure, 2 usage error. */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface Command {
  name: string;
  summary: string;
  run(args: string[], io: CommandIo): Promise<number>;
}
