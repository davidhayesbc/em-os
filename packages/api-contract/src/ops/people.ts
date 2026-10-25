import { z } from "zod";
import {
  Identity,
  LocalDate,
  Person,
  PersonNote,
  Relationship,
  Sensitivity,
} from "../entities/index.js";
import { defineOp } from "../op.js";

const NewPerson = Person.omit({
  id: true,
  capturedAt: true,
  updatedAt: true,
  occurredAt: true,
  retentionState: true,
}).extend({
  aliases: z.array(z.string().max(200)).max(50),
  occurredAt: Person.shape.occurredAt.optional(),
  retentionState: Person.shape.retentionState.optional(),
});
const NewIdentity = Identity.omit({
  id: true,
  capturedAt: true,
  updatedAt: true,
  occurredAt: true,
  retentionState: true,
}).extend({
  occurredAt: Identity.shape.occurredAt.optional(),
  retentionState: Identity.shape.retentionState.optional(),
});

export const peopleList = defineOp({
  name: "people.list",
  input: z.object({
    relationship: z.array(Relationship).max(Relationship.options.length).optional(),
    includeArchived: z.boolean().optional(),
  }),
  output: z.array(Person),
});
export const peopleGet = defineOp({
  name: "people.get",
  input: z.object({ id: z.string() }),
  output: z.object({ person: Person, identities: z.array(Identity), notes: z.array(PersonNote) }),
});
export const peopleCreate = defineOp({ name: "people.create", input: NewPerson, output: Person });
export const peopleUpdate = defineOp({
  name: "people.update",
  input: z.object({ id: z.string(), patch: NewPerson.partial() }),
  output: Person,
});
export const peopleAddIdentity = defineOp({
  name: "people.addIdentity",
  input: NewIdentity,
  output: Identity,
});
export const peopleResolve = defineOp({
  name: "people.resolve",
  input: z.object({ query: z.string() }),
  output: z.array(Person),
});
export const personNotesCreate = defineOp({
  name: "personNotes.create",
  input: z.object({
    personId: z.string(),
    text: z.string().max(100_000),
    date: LocalDate.optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    sensitivity: Sensitivity.optional(),
    sourceUrl: z
      .string()
      .max(2_048)
      .url()
      .refine((value) => {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      }, "Source URL must use HTTP or HTTPS")
      .optional(),
  }),
  output: PersonNote,
});
export const personNotesList = defineOp({
  name: "personNotes.list",
  input: z.object({
    personId: z.string(),
    from: PersonNote.shape.occurredAt.optional(),
    to: PersonNote.shape.occurredAt.optional(),
  }),
  output: z.array(PersonNote),
});
