import type { Identity, Person } from "@emos/api-contract";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

/** Resolve all matching people, ranking exact name/alias/handle matches before first-name prefixes. */
export function resolvePerson(query: string, people: Person[], identities: Identity[]): Person[] {
  const wanted = normalize(query);
  if (!wanted) return [];

  const handles = new Map<string, Set<string>>();
  for (const identity of identities) {
    const handle = normalize(identity.handle);
    const ids = handles.get(handle) ?? new Set<string>();
    ids.add(identity.personId);
    handles.set(handle, ids);
  }

  const exact: Person[] = [];
  const prefix: Person[] = [];
  for (const person of people) {
    const exactMatch =
      normalize(person.displayName) === wanted ||
      person.aliases.some((alias) => normalize(alias) === wanted) ||
      handles.get(wanted)?.has(person.id) === true;
    if (exactMatch) {
      exact.push(person);
      continue;
    }
    const firstName = normalize(person.displayName).split(/\s+/, 1)[0] ?? "";
    if (firstName.startsWith(wanted)) prefix.push(person);
  }
  return [...exact, ...prefix];
}
