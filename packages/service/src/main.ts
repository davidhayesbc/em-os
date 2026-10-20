// Service entry point: `node dist/main.js [--data-dir <path>] [--port <n>]`.
// Exit codes: 0 after a clean stop, 1 if the service could not start (e.g. "already running"),
// 2 for bad arguments.
import { homedir } from "node:os";
import { parseArgs } from "./config.js";
import { startService } from "./server.js";

let args: { dataDir: string; port: number };
try {
  args = parseArgs(process.argv.slice(2), process.env, process.platform, homedir());
} catch (e) {
  process.stderr.write(`emos-service: ${(e as Error).message}\n`);
  process.exit(2);
}

try {
  const svc = await startService(args);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    svc.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} catch (e) {
  process.stderr.write(`emos-service: ${(e as Error).message}\n`);
  process.exit(1);
}
