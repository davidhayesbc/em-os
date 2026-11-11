import type { Classification, Meeting, Profile } from "@emos/api-contract";

export function classifyMeeting(
  m: Meeting,
  rules: Profile["meetingRules"],
  selfPersonId: string | null,
): { classification: Classification; personId: string | null } {
  if (m.classificationSource === "user") {
    return { classification: m.classification, personId: m.personId };
  }

  for (const rule of rules) {
    const re = new RegExp(rule.pattern, "i");
    if (re.test(m.title)) {
      return { classification: rule.classification, personId: null };
    }
  }

  if (selfPersonId != null && m.attendees.length === 2) {
    const other = m.attendees.find((a) => a.personId !== selfPersonId);
    if (other?.personId != null) {
      return { classification: "one_on_one", personId: other.personId };
    }
  }

  if (m.attendees.length >= 3) {
    return { classification: "team", personId: null };
  }

  return { classification: "other", personId: null };
}
