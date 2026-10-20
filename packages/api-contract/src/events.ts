import { z } from "zod";

export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sync.status"), connectorId: z.string(), state: z.string() }),
  z.object({ type: z.literal("items.changed"), entity: z.string(), ids: z.array(z.string()) }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
