import type { AccountPreferences, AccountPreferencesUpdate, AppThemeSelection } from "../types/account";

export const appThemeSelections: ReadonlyArray<AppThemeSelection> = ["dark", "light", "system"];

type ThemePreferences = Pick<AccountPreferences, "theme" | "followSystemAppearance">;

export function readThemeSelection(preferences: ThemePreferences): AppThemeSelection {
  return preferences.followSystemAppearance ? "system" : preferences.theme;
}

export function readThemePreferences(preferences: ThemePreferences): ThemePreferences {
  return { theme: preferences.theme, followSystemAppearance: preferences.followSystemAppearance };
}

/** Choosing Dark or Light sends only `theme`; the server then turns following the system off. */
export function themeSelectionUpdate(selection: AppThemeSelection): AccountPreferencesUpdate {
  return selection === "system" ? { followSystemAppearance: true } : { theme: selection };
}

/** The local copy of a selection until the PATCH response replaces it, mirroring what the server stores. */
export function themeSelectionPreferences(selection: AppThemeSelection): Partial<ThemePreferences> {
  return selection === "system" ? { followSystemAppearance: true } : { theme: selection, followSystemAppearance: false };
}
