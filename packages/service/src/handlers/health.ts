import { API_VERSION } from "@emos/api-contract";
import type { Handler } from "../context.js";

export const healthGet: Handler<"health.get"> = (ctx) => ({
  apiVersion: API_VERSION,
  serviceVersion: ctx.config.serviceVersion,
  startedAt: ctx.config.startedAt,
  dataDir: ctx.config.dataDir,
  connectors: [],
});
