import { ApiError } from "@emos/api-contract";
import { buildPrep } from "@emos/core";
import type { Handler } from "../context.js";

export const prepGet: Handler<"prep.get"> = (ctx, { meetingId }) => {
  const meeting = ctx.store.meetings.get(meetingId);
  if (!meeting) throw new ApiError("not_found", "Meeting not found");

  const person = meeting.personId ? ctx.store.people.get(meeting.personId) : null;

  const previous = (() => {
    if (meeting.classification === "one_on_one" && person) {
      return ctx.store.meetings.previousOf(meeting, {
        classification: "one_on_one",
        personId: person.id,
      });
    }
    if (meeting.classification === "standup") {
      return ctx.store.meetings.previousOf(meeting, { classification: "standup" });
    }
    return null;
  })();

  const previousNotes = previous ? ctx.store.meetings.notes(previous.id) : [];

  const commitments = ctx.store.commitments.list({});

  return buildPrep({ meeting, person, commitments, previous, previousNotes });
};
