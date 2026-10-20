export type LogFields = Record<string, string | number | boolean>;

/** Structured logger. Fields carry ids and counts only, never content. */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const noop = (): void => {};

/** Discards everything. */
export const nullLogger: Logger = { info: noop, warn: noop, error: noop };
