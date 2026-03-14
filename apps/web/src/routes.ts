/**
 * Keep web settings navigation aligned with iOS:
 * Settings is a hub with separate workspace and account destinations.
 */
export const reviewRoute: string = "/review";
export const cardsRoute: string = "/cards";
export const chatRoute: string = "/chat";
export const settingsHubRoute: string = "/settings";
export const workspaceSettingsRoute: string = "/settings/workspace";
export const accountSettingsRoute: string = "/settings/account";
export const settingsAccessRoute: string = "/settings/access";
export const settingsOverviewRoute: string = "/settings/workspace/overview";
export const settingsSchedulerRoute: string = "/settings/workspace/scheduler";
export const settingsAccessDetailRoutePattern: string = "/settings/access/:accessKind";
export const settingsDecksRoute: string = "/settings/workspace/decks";
export const settingsDeckNewRoute: string = "/settings/workspace/decks/new";
export const settingsTagsRoute: string = "/settings/workspace/tags";
export const settingsDeviceRoute: string = "/settings/workspace/device";
export const accountStatusRoute: string = "/settings/account/status";
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
