import type { Commitment, CommitmentView, Meeting, Person, SourceItem } from "@emos/api-contract";

export interface MeetingPrep {
  meetingId: string;
  classification: Meeting["classification"];
  status: "ready" | "needs_work" | "nothing_linked";
  person: Person | null;
  openMine: CommitmentView[];
  openTheirs: CommitmentView[];
  linked: CommitmentView[];
  lastNotes: { sourceItemId: string; occurredAt: string; excerpt: string } | null;
  carriedActionItems: Meeting["actionItems"];
}

function isActive(c: Commitment): boolean {
  return c.status === "active";
}

export function buildPrep(i: {
  meeting: Meeting;
  person: Person | null;
  commitments: Commitment[];
  previous: Meeting | null;
  previousNotes: SourceItem[];
}): MeetingPrep {
  const { meeting, person, commitments, previous, previousNotes } = i;

  const linked = commitments.filter((c) => c.meetingId === meeting.id);

  let status: MeetingPrep["status"];
  if (linked.length === 0) {
    status = "nothing_linked";
  } else if (linked.some(isActive)) {
    status = "needs_work";
  } else {
    status = "ready";
  }

  const personId = person?.id ?? null;
  const openMine = personId
    ? commitments.filter(
        (c) => c.counterpartId === personId && c.direction === "mine" && isActive(c),
      )
    : [];
  const openTheirs = personId
    ? commitments.filter(
        (c) => c.counterpartId === personId && c.direction === "owed_to_me" && isActive(c),
      )
    : [];

  const lastNotes = ((): MeetingPrep["lastNotes"] => {
    if (previousNotes.length === 0) return null;
    const latest = previousNotes
      .slice()
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0];
    if (!latest) return null;
    return {
      sourceItemId: latest.id,
      occurredAt: latest.occurredAt,
      excerpt: latest.text.slice(0, 280),
    };
  })();

  const carriedActionItems =
    previous?.classification === "standup" ? previous.actionItems.filter((item) => !item.done) : [];

  return {
    meetingId: meeting.id,
    classification: meeting.classification,
    status,
    person,
    openMine,
    openTheirs,
    linked,
    lastNotes,
    carriedActionItems,
  };
}
