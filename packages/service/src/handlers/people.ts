import { ApiError } from "@emos/api-contract";
import { resolvePerson, startOfLocalDay, toLocalDate } from "@emos/core";
import type { Handler } from "../context.js";

const requirePerson = (ctx: Parameters<Handler<"people.get">>[0], id: string) => {
  const person = ctx.store.people.get(id);
  if (!person) throw new ApiError("not_found", "Person not found");
  return person;
};
const publish = (ctx: Parameters<Handler<"people.create">>[0], entity: string, id: string) =>
  ctx.events.publish({ type: "items.changed", entity, ids: [id] });

export const peopleList: Handler<"people.list"> = (ctx, input) => ctx.store.people.list(input);
export const peopleGet: Handler<"people.get"> = (ctx, { id }) => {
  const person = requirePerson(ctx, id);
  return {
    person,
    identities: ctx.store.people.identities(id),
    notes: ctx.store.people.notes(id),
  };
};
export const peopleCreate: Handler<"people.create"> = (ctx, input) =>
  ctx.store.transaction(() => {
    const person = ctx.store.people.create(input);
    publish(ctx, "person", person.id);
    return person;
  });
export const peopleUpdate: Handler<"people.update"> = (ctx, { id, patch }) =>
  ctx.store.transaction(() => {
    const person = ctx.store.people.update(id, patch);
    publish(ctx, "person", id);
    return person;
  });
export const peopleAddIdentity: Handler<"people.addIdentity"> = (ctx, input) =>
  ctx.store.transaction(() => {
    requirePerson(ctx, input.personId);
    const identity = ctx.store.people.addIdentity(input);
    publish(ctx, "identity", identity.id);
    return identity;
  });
export const peopleResolve: Handler<"people.resolve"> = (ctx, { query }) => {
  const people = ctx.store.people.list();
  const identities = people.flatMap((person) => ctx.store.people.identities(person.id));
  return resolvePerson(query, people, identities);
};
export const personNotesCreate: Handler<"personNotes.create"> = (ctx, input) =>
  ctx.store.transaction(() => {
    requirePerson(ctx, input.personId);
    const timeZone = ctx.store.settings.getProfile().displayTimeZone;
    const date = input.date ?? toLocalDate(ctx.clock.now(), timeZone);
    const note = ctx.store.people.addNote({
      personId: input.personId,
      text: input.text,
      tags: input.tags ?? [],
      sourceUrl: input.sourceUrl ?? null,
      sensitivity: input.sensitivity ?? "people_sensitive",
      origin: "manual",
      reviewState: "accepted",
      occurredAt: startOfLocalDay(date, timeZone).toISOString(),
    });
    publish(ctx, "person_note", note.id);
    return note;
  });
export const personNotesList: Handler<"personNotes.list"> = (ctx, { personId, from, to }) => {
  requirePerson(ctx, personId);
  return ctx.store.people.notes(personId, { from, to });
};
