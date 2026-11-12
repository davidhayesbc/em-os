import { z } from "zod";

const capabilitySchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.string()),
  result: z.object({
    items: z.string(),
    nextCursor: z.string().nullable().nullish(),
    fields: z.record(z.string(), z.string()),
  }),
});

export interface PresetDef {
  preset: string;
  server: string;
  capabilities: Record<
    string,
    {
      tool: string;
      args: Record<string, string>;
      result: {
        items: string;
        nextCursor?: string | null;
        fields: Record<string, string>;
      };
    }
  >;
}

export const Preset: z.ZodType<PresetDef> = z.object({
  preset: z.string(),
  server: z.string(),
  capabilities: z.record(z.string(), capabilitySchema),
});
