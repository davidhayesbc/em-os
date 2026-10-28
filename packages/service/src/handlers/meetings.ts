import { createHash } from "node:crypto";
import { ApiError, type Meeting, type NewSourceItem, type SourceItem } from "@emos/api-contract";
import type { Handler, ServiceContext } from "../context.js";

function exists(ctx: ServiceContext, table: string, id: string | null | undefined): boolean {
  if (id === null || id === undefined) return true;
  return Boolean(ctx.db.prepare(`SELECT 1 ok FROM ${table} WHERE id = ?`).get(id));
}

function requireMeeting(ctx: ServiceContext, id: string): Meeting {
  const meeting = ctx.store.meetings.get(id);
  if (!meeting) throw new ApiError("not_found", "Meeting not found");
  return meeting;
}

function publish(ctx: ServiceContext, entity: string, id: string): void {
  ctx.events.publish({ type: "items.changed", entity, ids: [id] });
}

function manualExternalId(meetingId: string, kind: string, text: string): string {
  const hash = createHash("sha256").update(`${meetingId}:${kind}:${text}`).digest("hex");
  return `manual:${meetingId}:${hash}`;
}

function contentHash(kind: string, text: string): string {
  return createHash("sha256").update(`${kind}:${text}`).digest("hex");
}

export const meetingsList: Handler<"meetings.list"> = (ctx, input) => {
  if (input.personId !== undefined) {
    if (!exists(ctx, "people", input.personId)) {
      throw new ApiError("not_found", "Person not found");
    }
  }
  return ctx.store.meetings.listRange(input.from, input.to, {
    personId: input.personId,
    classification: input.classification,
  });
};

export const meetingsGet: Handler<"meetings.get"> = (ctx, { id }) => {
  const meeting = requireMeeting(ctx, id);
  return { meeting, notes: ctx.store.meetings.notes(id) };
};

export const meetingsUpdate: Handler<"meetings.update"> = (ctx, { id, patch }) =>
  ctx.store.transaction(() => {
    requireMeeting(ctx, id);
    if (patch.personId !== undefined) {
      if (!exists(ctx, "people", patch.personId)) {
        throw new ApiError("not_found", "Person not found");
      }
    }
    const updated = ctx.store.meetings.update(id, patch);
    publish(ctx, "meeting", id);
    return updated;
  });

export const meetingsAttachNotes: Handler<"meetings.attachNotes"> = (ctx, input) =>
  ctx.store.transaction((): SourceItem => {
    const meeting = requireMeeting(ctx, input.meetingId);
    const kind: SourceItem["kind"] = input.kind === "summary" ? "note" : "transcript";
    const sensitivity: SourceItem["sensitivity"] =
      meeting.classification === "one_on_one" ? "people_sensitive" : "normal";
    const sourceItem: NewSourceItem = {
      connectorId: "manual",
      externalId: manualExternalId(meeting.id, input.kind, input.text),
      kind,
      origin: "manual",
      url: null,
      authorIdentityId: null,
      text: input.text,
      contentHash: contentHash(input.kind, input.text),
      sensitivity,
      sections: null,
      occurredAt: meeting.start,
    };
    const { item } = ctx.store.sourceItems.upsert(sourceItem);
    ctx.store.meetings.attachNote(meeting.id, item.id);
    publish(ctx, "source_item", item.id);
    publish(ctx, "meeting", meeting.id);
    return item;
  });
