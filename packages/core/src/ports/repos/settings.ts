import type { LayoutEntry, LayoutSurface, Profile } from "@emos/api-contract";

export interface SettingsRepo {
  getProfile(): Profile;
  setProfile(profile: Profile): void;
  getLayout(surface: LayoutSurface): LayoutEntry[] | null;
  setLayout(surface: LayoutSurface, layout: LayoutEntry[]): void;
}
