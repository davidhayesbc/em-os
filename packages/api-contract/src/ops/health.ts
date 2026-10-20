import { z } from "zod";
import { IsoDateTime } from "../entities/common.js";
import { defineOp } from "../op.js";

export const healthGet = defineOp({
  name: "health.get",
  input: z.object({}),
  output: z.object({
    apiVersion: z.number(),
    serviceVersion: z.string(),
    startedAt: IsoDateTime,
    dataDir: z.string(),
    connectors: z.array(
      z.object({
        id: z.string(),
        state: z.string(),
        lastSuccessAt: IsoDateTime.nullable(),
      }),
    ),
  }),
});
