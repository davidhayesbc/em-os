import type { ExternalMeeting } from "@emos/api-contract";
import {
  type CapabilityInvoker,
  type ConnectorDefinition,
  type ConnectorItem,
  type ConnectorKind,
  fixtureInvoker,
} from "@emos/connectors";
import { z } from "zod";

export interface RegistryEntry {
  def: ConnectorDefinition<unknown>;
  createInvoker(config: unknown): CapabilityInvoker;
}

const SyntheticAttendee = z.object({
  displayName: z.string(),
  email: z.string().nullable().default(null),
});

const SyntheticPage = z.object({
  meetings: z.array(
    z.object({
      externalId: z.string(),
      title: z.string(),
      start: z.string().datetime(),
      end: z.string().datetime(),
      allDay: z.boolean().default(false),
      status: z.enum(["confirmed", "cancelled"]).default("confirmed"),
      attendees: z.array(SyntheticAttendee).default([]),
    }),
  ),
  nextCursor: z.string().nullable(),
});

const SyntheticConfig = z.object({
  pages: z.array(SyntheticPage).default([]),
  secretKey: z.string().optional(),
});

/** Looser variant used by the runtime/invoker so persisted `$secretRef` markers don't break parsing. */
const InvokerConfig = SyntheticConfig.extend({
  secretKey: z.any().optional(),
});

type SyntheticConfig = z.infer<typeof SyntheticConfig>;

function buildMeeting(
  connectorId: string,
  input: SyntheticConfig["pages"][number]["meetings"][number],
): ExternalMeeting {
  return {
    connectorId,
    externalId: input.externalId,
    title: input.title,
    start: input.start,
    end: input.end,
    allDay: input.allDay,
    status: input.status,
    selfResponse: null,
    classification: "other",
    classificationSource: "auto",
    personId: null,
    attendees: input.attendees.map((a) => ({
      identityId: null,
      personId: null,
      displayName: a.displayName,
      email: a.email,
    })),
    actionItems: [],
    url: null,
    occurredAt: input.start,
  };
}

export const syntheticFixtureConnector = {
  id: "synthetic-fixture",
  kind: "calendar" as ConnectorKind,
  configSchema: SyntheticConfig,
  requiredCapabilities: ["fixture.page"],
  defaultIntervalMinutes: 15,
  async *sync(
    ctx,
    _cursor,
    _signal,
  ): AsyncIterableIterator<{ items: ConnectorItem[]; nextCursor: string | null }> {
    const cfg = InvokerConfig.parse(ctx.config);
    for (const page of cfg.pages) {
      await ctx.caps.call("fixture.page", {}, z.object({ ok: z.boolean() }));
      yield {
        items: page.meetings.map((m) => ({
          entity: "meeting",
          data: buildMeeting("synthetic-fixture", m),
        })),
        nextCursor: page.nextCursor,
      };
    }
  },
} as ConnectorDefinition<unknown>;

/**
 * Append-only registry of connector definitions. Each connector task adds its entry here.
 * P1-12 ships one synthetic fixture connector for tests.
 */
export const connectorRegistry: RegistryEntry[] = [
  {
    def: syntheticFixtureConnector,
    createInvoker: (config) => {
      const cfg = InvokerConfig.parse(config);
      return fixtureInvoker({
        "fixture.page": cfg.pages.map(() => ({ ok: true })),
      });
    },
  },
];
