import type { Store } from "@emos/core";
import { z } from "zod";
import { ConnectorError } from "../runtime/errors.js";
import type { ConnectorContext, ConnectorDefinition, SyncPage } from "../runtime/types.js";
import { applyCalendarEvent } from "./apply.js";
import type { CalendarEventDTO as CalendarEventDTOT } from "./dto.js";
import { CalendarEventDTO } from "./dto.js";
import { parseIcsEvents } from "./ics.js";

const McpConfig = z.object({
  transport: z.literal("mcp"),
  server: z.string(),
  preset: z.string(),
});

const IcsConfig = z.object({
  transport: z.literal("ics"),
  urlSecretKey: z.string().optional(),
  filePath: z.string().optional(),
});

const CalendarConfig = z.union([McpConfig, IcsConfig]);

export type CalendarConfig = z.infer<typeof CalendarConfig>;

const CalendarPage = z.object({
  items: z.array(CalendarEventDTO),
  nextCursor: z.string().nullable(),
});

function syncWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return { start, end };
}

function requireStore(ctx: ConnectorContext<CalendarConfig>): Store {
  if (!ctx.store) {
    throw new ConnectorError("config", "Calendar connector requires a store");
  }
  return ctx.store;
}

async function* syncMcp(
  ctx: ConnectorContext<CalendarConfig>,
  // The cursor is the provider page token *within a run*; the window is
  // recomputed each run, so we always start pagination from the beginning.
  _cursor: string | null,
): AsyncIterableIterator<SyncPage> {
  const { start, end } = syncWindow(ctx.now());

  let nextCursor: string | null = null;
  do {
    const page: z.infer<typeof CalendarPage> = await ctx.caps.call(
      "calendar.listEvents",
      {
        start: start.toISOString(),
        end: end.toISOString(),
        page: nextCursor,
      },
      CalendarPage,
    );
    const store = requireStore(ctx);
    const profile = store.settings.getProfile();

    yield {
      items: page.items.map((dto) => ({
        entity: "meeting",
        data: applyCalendarEvent(dto, {
          connectorId: "calendar",
          people: store.people,
          profile,
        }),
      })),
      nextCursor: page.nextCursor,
    };
    nextCursor = page.nextCursor;
  } while (nextCursor);
}

async function* syncIcs(ctx: ConnectorContext<CalendarConfig>): AsyncIterableIterator<SyncPage> {
  const cfg = ctx.config as { transport: "ics"; urlSecretKey?: string; filePath?: string };
  const store = requireStore(ctx);
  const profile = store.settings.getProfile();
  const { start, end } = syncWindow(ctx.now());

  function selfEmail(): string | null {
    const selfId = profile.selfPersonId;
    if (!selfId) return null;
    const identities = store.people.identities(selfId);
    const email = identities.find((i) => i.source === "email");
    return email?.handle ?? null;
  }

  let text: string;
  if (cfg.filePath) {
    const { readFileSync } = await import("node:fs");
    try {
      text = readFileSync(cfg.filePath, "utf8");
    } catch {
      throw new ConnectorError("config", "Calendar ICS file is not readable");
    }
  } else if (cfg.urlSecretKey) {
    // Fixture-driven builds only read files; URL path kept for the owner spike in ADR 0005.
    throw new ConnectorError("config", "Calendar ICS URL transport is not enabled in fixture mode");
  } else {
    throw new ConnectorError("config", "Calendar ICS transport requires filePath or urlSecretKey");
  }

  let dtos: CalendarEventDTOT[];
  try {
    dtos = parseIcsEvents({
      text,
      windowStart: start,
      windowEnd: end,
      displayZone: profile.displayTimeZone,
      selfEmail: selfEmail(),
    });
  } catch {
    throw new ConnectorError("schema", "Calendar ICS data is malformed");
  }

  yield {
    items: dtos.map((dto) => ({
      entity: "meeting",
      data: applyCalendarEvent(dto, {
        connectorId: "calendar",
        people: store.people,
        profile,
      }),
    })),
    nextCursor: null,
  };
}

export const calendarConnector: ConnectorDefinition<CalendarConfig> = {
  id: "calendar",
  kind: "calendar",
  configSchema: CalendarConfig,
  requiredCapabilities: ["calendar.listEvents"],
  defaultIntervalMinutes: 15,
  async *sync(ctx, cursor) {
    const cfg = CalendarConfig.parse(ctx.config);
    if (cfg.transport === "mcp") {
      yield* syncMcp(ctx, cursor);
    } else {
      yield* syncIcs(ctx);
    }
  },
};
