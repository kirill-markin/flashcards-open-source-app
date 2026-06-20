/**
 * Keep web settings navigation aligned with:
 * - apps/ios/Flashcards/Flashcards/App/AppNavigationTypes.swift
 * - apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/TopLevelDestinations.kt
 * - apps/android/app/src/main/java/com/flashcardsopensourceapp/app/navigation/SettingsDestinations.kt
 */
export const reviewRoute: string = "/review";
export const chatRoute: string = "/chat";
export const progressRoute: string = "/progress";
export const progressStreakHash: string = "streak";
export const progressStreakRoute: string = `${progressRoute}#${progressStreakHash}`;
export const progressLeaderboardHash: string = "leaderboard";
export const progressLeaderboardRoute: string = `${progressRoute}#${progressLeaderboardHash}`;
export const friendInviteRoutePrefix: string = "/invite";
export const friendInviteRoutePattern: string = `${friendInviteRoutePrefix}/:token`;
export const devPreviewsRoutePrefix: string = "/dev/previews";
export const friendInvitePreviewRoutePrefix: string = `${devPreviewsRoutePrefix}/invite`;
export const friendInvitePreviewIndexRoute: string = friendInvitePreviewRoutePrefix;
export const friendInvitePreviewRoutePattern: string = `${friendInvitePreviewRoutePrefix}/:state`;
export const cardsRoute: string = "/cards";
export const settingsHubRoute: string = "/settings";
export const settingsCurrentWorkspaceRoute: string = "/settings/current-workspace";
export const settingsDeviceRoute: string = "/settings/device";
export const settingsAccessRoute: string = "/settings/access";
export const settingsFeedbackRoute: string = "/settings/feedback";
export const settingsLanguageRoute: string = "/settings/language";
export const settingsLeaderboardParticipationRoute: string = "/settings/leaderboard-participation";
export const settingsReviewAnimationsRoute: string = "/settings/review-animations";
export const settingsAIChatSuggestionsRoute: string = "/settings/ai-chat-suggestions";
export const settingsServerRoute: string = "/settings/server";
export const settingsResetStudyProgressRoute: string = "/settings/reset-study-progress";
export const settingsDeleteCurrentWorkspaceRoute: string = "/settings/delete-current-workspace";
export const settingsTestRoute: string = "/settings/test";
export const settingsTestAnimationsRoute: string = "/settings/test/animations";
export const settingsSchedulerRoute: string = "/settings/scheduling";
export const settingsNotificationsRoute: string = "/settings/review-reminders";
export const settingsExportRoute: string = "/settings/export";
export const settingsAccessDetailRoutePattern: string = "/settings/access/:accessKind";
export const settingsDecksRoute: string = "/settings/decks";
export const settingsDeckNewRoute: string = "/settings/decks/new";
export const settingsTagsRoute: string = "/settings/tags";
export const accountStatusRoute: string = "/settings/account-status";
export const accountLegalRoute: string = "/settings/legal";
export const accountSupportRoute: string = "/settings/support";
export const accountOpenSourceRoute: string = "/settings/open-source";
export const accountAgentConnectionsRoute: string = "/settings/agent-connections";
export const accountDangerZoneRoute: string = "/settings/delete-account";

export function buildSettingsDeckDetailRoute(deckId: string): string {
  return `${settingsDecksRoute}/${deckId}`;
}

export function buildSettingsDeckEditRoute(deckId: string): string {
  return `${settingsDecksRoute}/${deckId}/edit`;
}

export function buildFriendInviteRoute(token: string): string {
  return `${friendInviteRoutePrefix}/${encodeURIComponent(token)}`;
}

export function buildFriendInvitePreviewRoute(state: string): string {
  return `${friendInvitePreviewRoutePrefix}/${encodeURIComponent(state)}`;
}

export function buildSettingsAccessDetailRoute(accessKind: "camera" | "microphone" | "photos-and-files"): string {
  return `${settingsAccessRoute}/${accessKind}`;
}
