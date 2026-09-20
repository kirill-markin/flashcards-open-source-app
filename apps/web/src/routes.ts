/**
 * Keep web settings navigation aligned with:
 * - apps/ios/Flashcards/Flashcards/App/Navigation/AppNavigationTypes.swift
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
export const shareRoute: string = "/share";
export const friendInviteRoutePrefix: string = "/invite";
export const friendInviteRoutePattern: string = `${friendInviteRoutePrefix}/:token`;
export const catalogImportRoutePrefix: string = "/catalog/import";
export const catalogImportRoutePattern: string = `${catalogImportRoutePrefix}/:packageVersionId`;
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
export const settingsAnalyticsRoute: string = "/settings/analytics";
export const settingsServerRoute: string = "/settings/server";
export const settingsResetStudyProgressRoute: string = "/settings/reset-study-progress";
export const settingsDeleteCurrentWorkspaceRoute: string = "/settings/delete-current-workspace";
export const settingsTestRoute: string = "/settings/test";
export const settingsTestAnimationsRoute: string = "/settings/test/animations";
export const settingsTestAppPlatformLinksRoute: string = "/settings/test/app-platform-links";
export const settingsTestCatalogImportSuccessRoute: string = "/settings/test/catalog-import-success";
export const settingsTestLocalSyncDiagnosticsRoute: string = "/settings/test/local-sync-diagnostics";
export const settingsSchedulerRoute: string = "/settings/scheduling";
export const settingsNotificationsRoute: string = "/settings/review-reminders";
export const settingsImportRoute: string = "/settings/import";
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

/**
 * The paths `App.tsx` serves above `AuthenticatedApp`: the literal ones, and the prefixes each of
 * whose route patterns takes exactly one dynamic segment. Anything else falls through to `/*`.
 */
const unauthenticatedRoutePaths: ReadonlyArray<string> = [shareRoute, friendInvitePreviewIndexRoute];
const unauthenticatedRoutePrefixes: ReadonlyArray<string> = [
  friendInviteRoutePrefix,
  catalogImportRoutePrefix,
  friendInvitePreviewRoutePrefix,
];

function hasOneSegmentUnder(prefix: string, path: string): boolean {
  if (path.startsWith(`${prefix}/`) === false) {
    return false;
  }

  const segment = path.slice(prefix.length + 1);
  return segment !== "" && segment.includes("/") === false;
}

/**
 * Normalizes a path the way React Router matches one: `<Route path>` is case-insensitive by
 * default, and repeated trailing slashes are tolerated. Without both, `/Share` or `/share//` would
 * read as an authenticated path here while `App.tsx` actually serves `ShareAppScreen`, and the two
 * definitions of "above `AuthenticatedApp`" would drift on a single capital letter.
 *
 * Both halves were read off `compilePath` in the react-router 8.3.1 sources: the pattern regexp is
 * built with the `i` flag unless a route opts into `caseSensitive`, and an `end` match appends
 * `\/*$`. This package.json asks for `^8.4.0`, so the installed minor is a step past the one that
 * could be checked here; treat the two claims as v8 behaviour rather than as pinned facts.
 *
 * Exported because the analytics surface classifier (apps/web/src/analytics/surfaces.ts) compares
 * paths against the same route constants and has to agree with this one.
 */
export function normalizeRoutePath(pathname: string): string {
  const withoutTrailingSlashes = pathname.replace(/\/+$/u, "");
  return withoutTrailingSlashes === "" ? "/" : withoutTrailingSlashes.toLowerCase();
}

/**
 * Whether this path is served by `AuthenticatedApp`, which is the only element that mounts the app
 * data provider — and with it the analytics session owner publisher. Analytics reads this to tell a
 * load where that publisher has not mounted yet from one where it never will
 * (apps/web/src/analytics/deliveryRuntime.ts).
 */
export function isAuthenticatedAppPath(pathname: string): boolean {
  const path = normalizeRoutePath(pathname);
  return unauthenticatedRoutePaths.includes(path) === false
    && unauthenticatedRoutePrefixes.some((prefix) => hasOneSegmentUnder(prefix, path)) === false;
}
