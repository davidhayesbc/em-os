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
    /**
     * Where secrets live. `memory` is the test-only `EMOS_SECRET_STORE=memory` switch: the
     * token is regenerated on every start and nothing is persisted. Clients should warn.
     */
    secretStore: z.enum(["keychain", "memory"]),
    connectors: z.array(
      z.object({
        id: z.string(),
        state: z.string(),
        lastSuccessAt: IsoDateTime.nullable(),
      }),
    ),
  }),
});
