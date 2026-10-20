import type { OpName } from "@emos/api-contract";
import type { Handler } from "../context.js";
import { backupCreate } from "./backup.js";
import { healthGet } from "./health.js";
import { serviceShutdown } from "./service.js";

// Append-only registry, keyed by op name (see @emos/api-contract ops). Other tasks add entries.
export const handlers: { [N in OpName]?: Handler<N> } = {
  "health.get": healthGet,
  "backup.create": backupCreate,
  "service.shutdown": serviceShutdown,
};
