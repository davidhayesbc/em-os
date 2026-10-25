import { z } from "zod";
import { LayoutEntry, LayoutSurface, Profile } from "../entities/settings.js";
import { defineOp } from "../op.js";

export const settingsGet = defineOp({
  name: "settings.get",
  input: z.object({}),
  output: Profile,
});

export const settingsUpdate = defineOp({
  name: "settings.update",
  input: z.object({ patch: z.record(z.string(), z.unknown()) }),
  output: Profile,
});

export const layoutGet = defineOp({
  name: "layout.get",
  input: z.object({ surface: LayoutSurface }),
  output: z.array(LayoutEntry).nullable(),
});

export const layoutSet = defineOp({
  name: "layout.set",
  input: z.object({ surface: LayoutSurface, layout: z.array(LayoutEntry) }),
  output: z.array(LayoutEntry),
});
