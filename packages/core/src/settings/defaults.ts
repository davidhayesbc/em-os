import { DEFAULT_PROFILE, Profile, type Profile as ProfileValue } from "@emos/api-contract";

type JsonObject = { [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeObject(base: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = merged[key];
    merged[key] = isObject(previous) && isObject(value) ? mergeObject(previous, value) : value;
  }
  return merged;
}

/** Returns a detached, schema-validated copy of the process-local defaults. */
export function defaultProfile(): ProfileValue {
  return Profile.parse(JSON.parse(JSON.stringify(DEFAULT_PROFILE)));
}

/** Deep-merges object fields, replaces arrays/scalars, then validates the complete profile. */
export function patchProfile(current: ProfileValue, patch: JsonObject): ProfileValue {
  return Profile.parse(mergeObject(current, patch));
}
