import { closeSync, constants as fsConstants, fstatSync, openSync, readSync } from "node:fs";
import type { Store } from "@emos/core";
import { z } from "zod";
import { ConnectorError, isConnectorError } from "../runtime/errors.js";
import type { ConnectorContext, ConnectorDefinition, SyncPage } from "../runtime/types.js";
import { applyCalendarEvent, normalizeEventDto } from "./apply.js";
import type { CalendarEventDTO as CalendarEventDTOT } from "./dto.js";
import { CalendarEventDTO } from "./dto.js";
import { MAX_EVENTS_TOTAL, MAX_ICS_FILE_BYTES, parseIcsEvents } from "./ics.js";

interface IcsFileSystem {
  openSync(path: string, flags: number): number;
  readSync(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  closeSync(fd: number): void;
  fstatSync(fd: number): { isFile(): boolean; size: number };
  constants: { O_RDONLY: number; O_NONBLOCK: number };
}

const realFs: IcsFileSystem = {
  openSync,
  readSync,
  closeSync,
  fstatSync,
  constants: fsConstants,
};

export function readIcsFile(path: string, maxBytes: number, fs: IcsFileSystem = realFs): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stats = fs.fstatSync(fd);
    if (!stats.isFile()) {
      throw new ConnectorError("config", "Calendar ICS file is not readable");
    }
    if (stats.size > maxBytes) {
      throw new ConnectorError("schema", "Calendar ICS file exceeds maximum size");
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < stats.size) {
      const chunk = fs.readSync(fd, buffer, bytesRead, maxBytes + 1 - bytesRead, bytesRead);
      if (chunk === 0) break;
      bytesRead += chunk;
      if (bytesRead > maxBytes) {
        throw new ConnectorError("schema", "Calendar ICS file exceeds maximum size");
      }
    }
    if (stats.size > 0 && bytesRead !== stats.size) {
      throw new ConnectorError("config", "Calendar ICS file is not readable");
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
  }
}

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

const MCP_PAGE_ITEM_LIMIT_MESSAGE = "Calendar MCP page exceeds maximum event count";
const MCP_SYNC_ITEM_LIMIT_MESSAGE = "Calendar MCP sync exceeded the maximum event count";

async function* syncMcp(
  ctx: ConnectorContext<CalendarConfig>,
  // The cursor is the provider page token *within a run*; the window is
  // recomputed each run, so we always start pagination from the beginning.
  _cursor: string | null,
): AsyncIterableIterator<SyncPage> {
  const { start, end } = syncWindow(ctx.now());

  let nextCursor: string | null = null;
  let totalItems = 0;
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

    if (page.items.length > MAX_EVENTS_TOTAL) {
      throw new ConnectorError("schema", MCP_PAGE_ITEM_LIMIT_MESSAGE);
    }
    if (totalItems + page.items.length > MAX_EVENTS_TOTAL) {
      throw new ConnectorError("schema", MCP_SYNC_ITEM_LIMIT_MESSAGE);
    }
    totalItems += page.items.length;

    const store = requireStore(ctx);
    const profile = store.settings.getProfile();

    yield {
      items: page.items.map((dto) => ({
        entity: "meeting",
        data: applyCalendarEvent(normalizeEventDto(dto), {
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
    try {
      text = readIcsFile(cfg.filePath, MAX_ICS_FILE_BYTES);
    } catch (e) {
      if (isConnectorError(e)) {
        throw e;
      }
      throw new ConnectorError("config", "Calendar ICS file is not readable");
    }
  } else if (cfg.urlSecretKey) {
    // Fixture-driven builds only read files; URL path kept for the owner spike in ADR 0005.
    throw new ConnectorError("config", "Calendar ICS URL transport is not enabled in fixture mode");
  } else {
    throw new ConnectorError("config", "Calendar ICS transport requires filePath or urlSecretKey");
  }

  // Resolve self identity outside the parse/validation try so store failures are
  // classified independently of ICS schema errors (O2).
  const selfEmailValue = selfEmail();

  let dtos: CalendarEventDTOT[];
  try {
    dtos = parseIcsEvents({
      text,
      windowStart: start,
      windowEnd: end,
      displayZone: profile.displayTimeZone,
      selfEmail: selfEmailValue,
    }) as CalendarEventDTOT[];
    // parseIcsEvents returns plain objects typed as CalendarEventDTO; validate
    // the shape so DTO drift (e.g. a missing SUMMARY becoming undefined) becomes
    // a classified schema error instead of a raw database error (R5).
    CalendarEventDTO.array().parse(dtos);
  } catch (e) {
    if (isConnectorError(e)) {
      throw e;
    }
    throw new ConnectorError("schema", "Calendar ICS data is malformed");
  }

  yield {
    items: dtos.map((dto) => ({
      entity: "meeting",
      data: applyCalendarEvent(normalizeEventDto(dto), {
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
