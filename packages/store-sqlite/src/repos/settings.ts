import {
  LayoutEntry,
  type LayoutEntry as LayoutEntryValue,
  type LayoutSurface,
  Profile,
  type Profile as ProfileValue,
} from "@emos/api-contract";
import { defaultProfile, type SettingsRepo } from "@emos/core";
import type { Db } from "../driver.js";

export function createSettingsRepo(db: Db): SettingsRepo {
  const getSetting = db.prepare("SELECT value FROM settings WHERE key = ?");
  const setSetting = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const getLayout = db.prepare("SELECT entries FROM layouts WHERE surface = ?");
  const upsertLayout = db.prepare(
    "INSERT INTO layouts (surface, entries) VALUES (?, ?) ON CONFLICT(surface) DO UPDATE SET entries = excluded.entries",
  );

  return {
    getProfile(): ProfileValue {
      const row = getSetting.get<{ value: string }>("profile");
      return row ? Profile.parse(JSON.parse(row.value)) : defaultProfile();
    },
    setProfile(profile): void {
      setSetting.run("profile", JSON.stringify(Profile.parse(profile)));
    },
    getLayout(surface): LayoutEntryValue[] | null {
      const row = getLayout.get<{ entries: string }>(surface);
      return row ? LayoutEntry.array().parse(JSON.parse(row.entries)) : null;
    },
    setLayout(surface: LayoutSurface, layout: LayoutEntryValue[]): void {
      upsertLayout.run(surface, JSON.stringify(LayoutEntry.array().parse(layout)));
    },
  };
}
