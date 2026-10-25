import { ApiError } from "@emos/api-contract";
import { parseQuickCapture, resolvePerson } from "@emos/core";
import type { Handler } from "../context.js";

export const commitmentsQuickCapture: Handler<"commitments.quickCapture"> = (
  ctx,
  { text, counterpartId },
) => {
  const profile = ctx.store.settings.getProfile();
  const selfPersonId = profile.selfPersonId;
  if (!selfPersonId) return { status: "invalid", message: "Finish setup first" };

  const parsed = parseQuickCapture(text, ctx.clock.now(), profile.displayTimeZone);
  if ("error" in parsed) {
    return {
      status: "invalid",
      message: parsed.error === "empty_title" ? "A title is required" : "Due date is out of range",
    };
  }

  let resolvedCounterpartId = counterpartId ?? null;
  if (resolvedCounterpartId) {
    if (!ctx.store.people.get(resolvedCounterpartId)) {
      throw new ApiError("not_found", "counterpartId not found");
    }
  } else if (parsed.personQuery) {
    const people = ctx.store.people.list();
    const identities = people.flatMap((person) => ctx.store.people.identities(person.id));
    const candidates = [
      ...new Map(
        [
          ...resolvePerson(parsed.personQuery, people, identities),
          ...resolvePerson(`@${parsed.personQuery}`, people, identities),
        ].map((person) => [person.id, person]),
      ).values(),
    ];
    const [candidate] = candidates;
    if (candidates.length !== 1 || !candidate)
      return { status: "needs_person", parsed, candidates };
    resolvedCounterpartId = candidate.id;
  }

  return ctx.store.transaction(() => {
    const commitment = ctx.store.commitments.create({
      direction: parsed.direction,
      status: "active",
      dropReason: null,
      urgency: parsed.urgency,
      priority: parsed.priority,
      due: parsed.due,
      tags: parsed.tags,
      createdBy: "user",
      ownerId: selfPersonId,
      counterpartId: resolvedCounterpartId,
      goalId: null,
      meetingId: null,
      title: parsed.title,
      notes: "",
      pinned: false,
      effortMinutes: null,
      snoozedUntil: null,
      completedAt: null,
      recurrence: parsed.recurrence,
      seriesId: null,
    });
    ctx.events.publish({ type: "items.changed", entity: "commitment", ids: [commitment.id] });
    return { status: "created" as const, commitment };
  });
};
