import type {
  Classification,
  ExternalMeeting,
  IsoDateTime,
  Meeting,
  SourceItem,
} from "@emos/api-contract";

export interface MeetingsRepo {
  upsertExternal(m: ExternalMeeting): { meeting: Meeting; created: boolean };
  get(id: string): Meeting | null;
  listRange(
    from: IsoDateTime,
    to: IsoDateTime,
    f?: { includeCancelled?: boolean; personId?: string; classification?: Classification },
  ): Meeting[];
  update(
    id: string,
    patch: Partial<Pick<Meeting, "classification" | "personId" | "actionItems">>,
  ): Meeting;
  attachNote(meetingId: string, sourceItemId: string): void;
  notes(meetingId: string): SourceItem[];
  previousOf(
    meeting: Meeting,
    f?: { classification?: Classification; personId?: string },
  ): Meeting | null;
}
