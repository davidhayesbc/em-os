import { z } from "zod";

/** UTC instant, ISO-8601 with a trailing `Z`. Offsets and local (zone-less) values are rejected. */
// Zod 3: z.string().datetime({ offset: false }). Zod 4: z.iso.datetime() is Z-only by default.
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Calendar date, `YYYY-MM-DD`. Always paired with a separate IANA time-zone field where it matters. */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type LocalDate = z.infer<typeof LocalDate>;

export const Sensitivity = z.enum(["normal", "people_sensitive", "private"]);
export type Sensitivity = z.infer<typeof Sensitivity>;

export const RetentionState = z.enum(["active", "archived", "excluded", "purged"]);
export type RetentionState = z.infer<typeof RetentionState>;

/** Fields every entity carries (spec 7.1 and 7.6). */
export const Dated = z.object({
  occurredAt: IsoDateTime,
  capturedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  retentionState: RetentionState,
});
export type Dated = z.infer<typeof Dated>;

/**
 * Creation shape for an entity `X`: everything except `id`, `capturedAt` and `updatedAt`
 * (assigned by the service). `occurredAt` and `retentionState` are optional and default to
 * now and `"active"`.
 */
export type NewEntity<T extends Dated & { id: string }> = Omit<
  T,
  "id" | "capturedAt" | "updatedAt" | "occurredAt" | "retentionState"
> &
  Partial<Pick<T, "occurredAt" | "retentionState">>;
