import type { z } from "zod";
import { ConnectorError } from "./errors.js";
import type { CapabilityInvoker } from "./types.js";

/**
 * A test invoker that returns successive canned responses per capability. The responses
 * record is `{ capabilityName: [response1, response2, ...] }`; each call to that capability
 * consumes the next response.
 */
export function fixtureInvoker(
  responses: Record<string, unknown[]>,
  deps: { clone?: <T>(v: T) => T } = {},
): CapabilityInvoker {
  const counters: Record<string, number> = {};
  const clone = deps.clone ?? structuredClone;

  return {
    async call<T>(
      capability: string,
      _args: Record<string, unknown>,
      schema: z.ZodType<T>,
    ): Promise<T> {
      const list = responses[capability];
      if (!list || list.length === 0) {
        throw new ConnectorError("config", `No fixture response for capability ${capability}`);
      }
      const index = counters[capability] ?? 0;
      counters[capability] = index + 1;
      if (index >= list.length) {
        throw new ConnectorError("config", `Fixture responses exhausted for ${capability}`);
      }
      const value = clone(list[index] as T);
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new ConnectorError("schema", `Fixture response for ${capability} failed validation`);
      }
      return parsed.data;
    },
  };
}
