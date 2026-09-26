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
export const settingsAccentColorRoute: string = "/settings/accent-color";
export const settingsReviewAnimationsRoute: string = "/settings/review-animations";
export const settingsAIChatSuggestionsRoute: string = "/settings/ai-chat-suggestions";
export const settingsSubscriptionRoute: string = "/settings/subscription";
export const settingsOwnOpenAIKeyRoute: string = "/settings/own-openai-key";
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

/**
 * The workspace-scoped path space the app renders under: the route constants above that
 * `AuthenticatedApp` serves are workspace-relative suffixes that `buildWorkspaceRoute` appends to
 * `/w/<workspaceId>`. The public routes are the exception — `shareRoute`, the friend-invite,
 * catalog-import and dev-preview prefixes and their patterns, collected in
 * `unauthenticatedRoutePaths` and `unauthenticatedRoutePrefixes` below, are signed-out entry points
 * that `App.tsx` mounts above `AuthenticatedApp`, so they stay top-level and never sit under a
 * workspace.
 */
export const workspaceRoutePrefix: string = "/w";
export const workspaceRoutePattern: string = `${workspaceRoutePrefix}/:workspaceId`;

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
 * `appPath` is one of the workspace-relative route constants above — never a public route, which
 * `App.tsx` serves top-level — so it already starts with `/` and a `#hash` suffix such as
 * `progressStreakRoute`'s rides along with the concatenation.
 */
export function buildWorkspaceRoute(workspaceId: string, appPath: string): string {
  return `${workspaceRoutePrefix}/${encodeURIComponent(workspaceId)}${appPath}`;
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
 * The platform's workspace-id contract, copied from `apps/backend/src/workspaces/identity.ts` so the
 * two stay one contract rather than two coincidences: loose hex in 8-4-4-4-12, with no RFC 4122
 * version or variant nibble required. Migration 0018 mints ids by slicing a raw `md5()` digest, so
 * they set neither nibble, and a stricter pattern here would reject live workspaces — and with them
 * every `/w/<workspaceId>` address the app builds for one.
 *
 * Tested against an already normalized path, which is lowercased, hence no case-insensitive flag.
 */
const workspaceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Splits `/w/<workspaceId><appPath>` into the workspace it names and the path the app serves under
 * it, so the classifiers below can read a workspace-scoped path as the app path it carries. A first
 * segment that is not a workspace id under `workspaceIdPattern` above names no workspace, so that
 * path is returned unsplit and classifies as it does today.
 *
 * `appPath` is always sliced out of the raw `pathname` — the remainder after the workspace segment
 * when the prefix matched, `/` when nothing follows the workspace, and the untouched `pathname` when
 * it did not match. Only the matching and the workspace-id check run on the normalized path, so a
 * caller that forwards `appPath` into a redirect keeps a case-sensitive invite token or
 * `packageVersionId` intact. A caller that instead compares `appPath` to a route constant has to
 * normalize it first. `workspaceId` is the normalized, lowercased segment.
 */
export function splitWorkspaceRoutePath(pathname: string): Readonly<{ workspaceId: string | null; appPath: string }> {
  const path = normalizeRoutePath(pathname);
  if (path.startsWith(`${workspaceRoutePrefix}/`) === false) {
    return { workspaceId: null, appPath: pathname };
  }

  const afterPrefix = path.slice(workspaceRoutePrefix.length + 1);
  const appPathStart = afterPrefix.indexOf("/");
  const workspaceId = appPathStart === -1 ? afterPrefix : afterPrefix.slice(0, appPathStart);
  if (workspaceIdPattern.test(workspaceId) === false) {
    return { workspaceId: null, appPath: pathname };
  }

  // Sliced out of the raw `pathname` at the offset the normalized path reports, which holds because
  // the prefix and the workspace id matched above are ASCII and identical in length in both.
  const rawAppPath = pathname.slice(workspaceRoutePrefix.length + 1 + workspaceId.length);
  return { workspaceId, appPath: rawAppPath === "" ? "/" : rawAppPath };
}

/**
 * Whether this path is served by `AuthenticatedApp`, which is the only element that mounts the app
 * data provider — and with it the analytics session owner publisher. Analytics reads this to tell a
 * load where that publisher has not mounted yet from one where it never will
 * (apps/web/src/analytics/deliveryRuntime.ts).
 */
export function isAuthenticatedAppPath(pathname: string): boolean {
  const { workspaceId, appPath } = splitWorkspaceRoutePath(pathname);
  if (workspaceId !== null) {
    // Nothing is mounted above `AuthenticatedApp` under `/w/<workspaceId>`: the public routes are
    // top-level only, so any path carrying a recognised workspace segment falls to `/*`.
    return true;
  }

  const path = normalizeRoutePath(appPath);
  return unauthenticatedRoutePaths.includes(path) === false
    && unauthenticatedRoutePrefixes.some((prefix) => hasOneSegmentUnder(prefix, path)) === false;
}
