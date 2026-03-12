/**
 * Keep web workspace navigation aligned with iOS:
 * the primary workspace destinations are Review, Cards, AI chat, and Settings.
 * Decks and tags belong under workspace settings on both platforms.
 * Web exposes account settings from the account menu, while iOS exposes account
 * settings as a nested destination inside the Settings tab.
 */
export const reviewRoute: string = "/review";
export const cardsRoute: string = "/cards";
export const chatRoute: string = "/chat";
export const workspaceSettingsRoute: string = "/settings";
export const accountSettingsRoute: string = "/account";
export const settingsDecksRoute: string = "/settings/decks";
export const settingsDeckNewRoute: string = "/settings/decks/new";
export const settingsTagsRoute: string = "/settings/tags";

export function buildSettingsDeckDetailRoute(deckId: string): string {
  return `${settingsDecksRoute}/${deckId}`;
}

export function buildSettingsDeckEditRoute(deckId: string): string {
  return `${settingsDecksRoute}/${deckId}/edit`;
}
