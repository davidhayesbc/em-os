import { healthGet } from "./health.js";

// Append-only registry, keyed by op name. Other tasks add entries.
export const ops = {
  "health.get": healthGet,
} as const;
