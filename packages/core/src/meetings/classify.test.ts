import type { Meeting, Profile } from "@emos/api-contract";
import { describe, expect, it } from "vitest";
import { classifyMeeting } from "./classify.js";

const at = "2026-10-25T00:00:00.000Z";

function meeting(overrides: Partial<Meeting> & { title: string }): Meeting {
  return {
    id: "mtg_1",
    connectorId: "cal",
    externalId: "ext-1",
    start: "2026-10-25T10:00:00.000Z",
    end: "2026-10-25T10:30:00.000Z",
    allDay: false,
    status: "confirmed",
    selfResponse: "accepted",
    classification: "other",
    classificationSource: "auto",
    personId: null,
    attendees: [],
    actionItems: [],
    url: null,
    occurredAt: at,
    capturedAt: at,
    updatedAt: at,
    retentionState: "active",
    ...overrides,
  };
}

describe("classifyMeeting", () => {
  it("classifies by the first matching rule", () => {
    const rules: Profile["meetingRules"] = [
      { pattern: "^standup|stand-up", classification: "standup" },
      { pattern: "1:1", classification: "one_on_one" },
    ];
    expect(classifyMeeting(meeting({ title: "Daily stand-up" }), rules, "per_self")).toEqual({
      classification: "standup",
      personId: null,
    });
    expect(classifyMeeting(meeting({ title: "standup" }), rules, "per_self")).toEqual({
      classification: "standup",
      personId: null,
    });
  });

  it("classifies two attendees (self + one known person) as one_on_one", () => {
    const m = meeting({
      title: "Chat",
      attendees: [
        { identityId: null, personId: "per_self", displayName: "Me", email: "me@example.com" },
        {
          identityId: null,
          personId: "per_alex",
          displayName: "Alex Rivera",
          email: "alex@example.com",
        },
      ],
    });
    expect(classifyMeeting(m, [], "per_self")).toEqual({
      classification: "one_on_one",
      personId: "per_alex",
    });
  });

  it("classifies a non-roster other attendee as other", () => {
    const m = meeting({
      title: "Chat",
      attendees: [
        { identityId: null, personId: "per_self", displayName: "Me", email: "me@example.com" },
        { identityId: null, personId: null, displayName: "Unknown", email: "unknown@example.com" },
      ],
    });
    expect(classifyMeeting(m, [], "per_self")).toEqual({
      classification: "other",
      personId: null,
    });
  });

  it("classifies three or more attendees as team", () => {
    const m = meeting({
      title: "Sprint planning",
      attendees: [
        { identityId: null, personId: "per_self", displayName: "Me", email: "me@example.com" },
        {
          identityId: null,
          personId: "per_alex",
          displayName: "Alex Rivera",
          email: "alex@example.com",
        },
        {
          identityId: null,
          personId: "per_sam",
          displayName: "Sam Chen",
          email: "sam@example.com",
        },
      ],
    });
    expect(classifyMeeting(m, [], "per_self")).toEqual({
      classification: "team",
      personId: null,
    });
  });

  it("falls back to other when no rules and too few attendees", () => {
    const m = meeting({
      title: "Chat",
      attendees: [
        { identityId: null, personId: "per_self", displayName: "Me", email: "me@example.com" },
      ],
    });
    expect(classifyMeeting(m, [], "per_self")).toEqual({
      classification: "other",
      personId: null,
    });
  });

  it("never overwrites a user-set classification", () => {
    const m = meeting({
      title: "Daily stand-up",
      classification: "team",
      classificationSource: "user",
      personId: null,
    });
    expect(
      classifyMeeting(m, [{ pattern: "^standup|stand-up", classification: "standup" }], "per_self"),
    ).toEqual({
      classification: "team",
      personId: null,
    });
  });
});
