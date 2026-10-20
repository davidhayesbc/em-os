// The detached service's stdout/stderr go to `<dataDir>/logs/service.log` (append, 0600, in a
// 0700 dir) so a failed start can say why. The service logs ids and counts only, never content.
// Size cap: over 5 MiB at spawn time, the log is renamed to `service.log.1` (replacing it).
//
// Duplicated in @emos/cli (`src/service-log.ts`); a CLI test pins the two files together.
import {
  closeSync,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

export const SERVICE_LOG_MAX_BYTES = 5 * 1024 * 1024;
const POSIX = process.platform !== "win32";

export interface ServiceLog {
  path: string;
  /** Append-mode fd to hand to the child as stdout and stderr. The caller closes it. */
  fd: number;
  /** File size when opened: what this start writes begins here. */
  offset: number;
}

export function serviceLogPath(dataDir: string): string {
  return join(dataDir, "logs", "service.log");
}

/** Creates `logs/` (0700), rotates an oversized log, then opens it for append (0600). */
export function openServiceLog(
  dataDir: string,
  maxBytes: number = SERVICE_LOG_MAX_BYTES,
): ServiceLog {
  const path = serviceLogPath(dataDir);
  mkdirSync(join(dataDir, "logs"), { recursive: true, ...(POSIX ? { mode: 0o700 } : {}) });
  try {
    if (statSync(path).size > maxBytes) renameSync(path, `${path}.1`);
  } catch {
    // no log yet, or it is held open elsewhere (Windows): keep appending
  }
  const fd = openSync(path, "a", 0o600);
  try {
    if (POSIX) fchmodSync(fd, 0o600);
    return { path, fd, offset: fstatSync(fd).size };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}

/** The last `lines` non-empty lines written at or after `offset` (at most the last 64 KiB). */
export function readLogTail(path: string, offset = 0, lines = 20): string[] {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return [];
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(offset, size - 64 * 1024);
    if (size <= start) return [];
    const buf = Buffer.alloc(size - start);
    let read = 0;
    while (read < buf.length) {
      const n = readSync(fd, buf, read, buf.length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    return buf
      .subarray(0, read)
      .toString("utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .slice(-lines);
  } finally {
    closeSync(fd);
  }
}

/** `message` plus the log lines from this start, for an error the user will read. */
export function withLogTail(message: string, log: { path: string; offset: number }): string {
  const tail = readLogTail(log.path, log.offset);
  return tail.length === 0
    ? `${message} (no output in ${log.path})`
    : `${message}. Last log lines (${log.path}):\n${tail.join("\n")}`;
}
