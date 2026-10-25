import { ApiError } from "@emos/api-contract";
import { patchProfile } from "@emos/core";
import { ZodError } from "zod";
import type { Handler } from "../context.js";

export const settingsGet: Handler<"settings.get"> = (ctx) => ctx.store.settings.getProfile();

export const settingsUpdate: Handler<"settings.update"> = (ctx, { patch }) => {
  try {
    const profile = patchProfile(ctx.store.settings.getProfile(), patch);
    ctx.store.settings.setProfile(profile);
    return profile;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError("invalid_input", "Invalid profile patch", { cause: error });
    }
    throw error;
  }
};

export const layoutGet: Handler<"layout.get"> = (ctx, { surface }) =>
  ctx.store.settings.getLayout(surface);

export const layoutSet: Handler<"layout.set"> = (ctx, { surface, layout }) => {
  ctx.store.settings.setLayout(surface, layout);
  return layout;
};
