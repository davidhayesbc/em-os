import type { ExternalMeeting, NewSourceItem } from "@emos/api-contract";
import type { Logger } from "@emos/core";
import type { z } from "zod";

export type ConnectorKind =
  | "chat"
  | "calendar"
  | "email"
  | "meeting_notes"
  | "code_host"
  | "tickets"
  | "docs"
  | "observability";

export interface CapabilityInvoker {
  call<T>(capability: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T>;
}

export interface ConnectorContext<C> {
  config: C;
  caps: CapabilityInvoker;
  log: Logger;
  now(): Date;
}

export type ConnectorItem =
  | { entity: "meeting"; data: ExternalMeeting }
  | { entity: "source_item"; data: NewSourceItem };

export interface SyncPage {
  items: ConnectorItem[];
  nextCursor: string | null;
}

export interface ConnectorDefinition<C> {
  id: string;
  kind: ConnectorKind;
  configSchema: z.ZodType<C>;
  requiredCapabilities: string[];
  defaultIntervalMinutes: number;
  sync(
    ctx: ConnectorContext<C>,
    cursor: string | null,
    signal: AbortSignal,
  ): AsyncIterable<SyncPage>;
}

/** Minimal event bus surface used by the runtime. */
export interface SyncEventBus {
  publish(e: { type: "sync.status"; connectorId: string; state: string }): void;
}

export interface Appliers {
  meeting(item: ExternalMeeting): void;
  sourceItem(item: NewSourceItem): void;
}
