/**
 * Keep web settings navigation aligned with:
 * - apps/ios/Flashcards/Flashcards/FlashcardsTypes.swift
 * - apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/AppDestination.kt
 */
export const reviewRoute: string = "/review";
export const cardsRoute: string = "/cards";
export const chatRoute: string = "/chat";
export const settingsHubRoute: string = "/settings";
export const settingsCurrentWorkspaceRoute: string = "/settings/current-workspace";
export const workspaceSettingsRoute: string = "/settings/workspace";
export const accountSettingsRoute: string = "/settings/account";
export const settingsDeviceRoute: string = "/settings/device";
export const settingsAccessRoute: string = "/settings/access";
export const settingsOverviewRoute: string = "/settings/workspace/overview";
export const settingsSchedulerRoute: string = "/settings/workspace/scheduler";
export const settingsExportRoute: string = "/settings/workspace/export";
export const settingsAccessDetailRoutePattern: string = "/settings/access/:accessKind";
export const settingsDecksRoute: string = "/settings/workspace/decks";
export const settingsDeckNewRoute: string = "/settings/workspace/decks/new";
export const settingsTagsRoute: string = "/settings/workspace/tags";
export const accountStatusRoute: string = "/settings/account/status";
export const accountLegalSupportRoute: string = "/settings/account/legal-support";
export const accountOpenSourceRoute: string = "/settings/account/open-source";
export const accountAgentConnectionsRoute: string = "/settings/account/agent-connections";
export const accountDangerZoneRoute: string = "/settings/account/danger-zone";

export function buildSettingsDeckDetailRoute(deckId: string): string {
  return `${settingsDecksRoute}/${deckId}`;
}

export function buildSettingsDeckEditRoute(deckId: string): string {
  return `${settingsDecksRoute}/${deckId}/edit`;
}

export function buildSettingsAccessDetailRoute(accessKind: "camera" | "microphone" | "photos-and-files"): string {
  return `${settingsAccessRoute}/${accessKind}`;
}
