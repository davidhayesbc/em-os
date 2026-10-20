import type { OpName } from "@emos/api-contract";
import type { Handler } from "../context.js";
import { healthGet } from "./health.js";

// Append-only registry, keyed by op name (see @emos/api-contract ops). Other tasks add entries.
export const handlers: { [N in OpName]?: Handler<N> } = {
  "health.get": healthGet,
};
