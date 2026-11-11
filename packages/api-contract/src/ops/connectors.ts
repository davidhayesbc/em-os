import { z } from "zod";
import { IsoDateTime } from "../entities/common.js";
import { defineOp } from "../op.js";

export const ConnectorKind = z.enum([
  "chat",
  "calendar",
  "email",
  "meeting_notes",
  "code_host",
  "tickets",
  "docs",
  "observability",
]);
export type ConnectorKind = z.infer<typeof ConnectorKind>;

export const ConnectorRunState = z.enum(["never", "syncing", "ok", "offline", "error"]);
export type ConnectorRunState = z.infer<typeof ConnectorRunState>;

export const connectorsList = defineOp({
  name: "connectors.list",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.string(),
      kind: ConnectorKind,
      enabled: z.boolean(),
      state: ConnectorRunState,
      lastSuccessAt: IsoDateTime.nullable(),
      lastError: z.string().nullable(),
    }),
  ),
});

export const connectorsSync = defineOp({
  name: "connectors.sync",
  input: z.object({ id: z.string() }),
  output: z.object({
    pages: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
  }),
});

export const connectorsConfigure = defineOp({
  name: "connectors.configure",
  input: z.object({
    id: z.string(),
    enabled: z.boolean(),
    config: z.unknown(),
  }),
  output: z.object({}),
});
