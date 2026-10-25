import type {
  Identity,
  IsoDateTime,
  NewIdentity,
  NewPerson,
  NewPersonNote,
  Person,
  PersonNote,
  Relationship,
} from "@emos/api-contract";

export interface PeopleRepo {
  create(p: NewPerson): Person;
  update(id: string, patch: Partial<NewPerson>): Person;
  get(id: string): Person | null;
  list(f?: { relationship?: Relationship[]; includeArchived?: boolean }): Person[];
  addIdentity(i: NewIdentity): Identity;
  identities(personId: string): Identity[];
  findIdentity(source: string, handle: string): Identity | null;
  addNote(n: NewPersonNote): PersonNote;
  notes(personId: string, range?: { from?: IsoDateTime; to?: IsoDateTime }): PersonNote[];
}
