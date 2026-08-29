import {
  cardsRoute,
  catalogImportRoutePrefix,
  chatRoute,
  devPreviewsRoutePrefix,
  friendInviteRoutePrefix,
  progressRoute,
  reviewRoute,
  settingsDecksRoute,
  settingsHubRoute,
  settingsTagsRoute,
  shareRoute,
} from "../routes";
import type { AnalyticsSurface } from "./events";

/**
 * Whether `pathname` is `prefix` followed by exactly one non-empty segment.
 *
 * Every route this is asked about is a `:param` pattern with one segment after the prefix, and a
 * bare prefix match would claim the deeper paths too — `/invite/a/b` matches no `<Route>` at all and
 * falls through to the shell's empty content area, which is the same "renders nothing" case that
 * maps to null below.
 */
function isSingleSegmentRoute(pathname: string, prefix: string): boolean {
  if (pathname.startsWith(`${prefix}/`) === false) {
    return false;
  }

  const segments = pathname.slice(prefix.length + 1).split("/");
  return segments.length === 1 && segments[0] !== "";
}

function readDeckRouteSegments(pathname: string): ReadonlyArray<string> {
  if (pathname.startsWith(`${settingsDecksRoute}/`) === false) {
    return [];
  }

  return pathname.slice(settingsDecksRoute.length + 1).split("/");
}

function isDeckDetailRoute(pathname: string): boolean {
  const deckSegments = readDeckRouteSegments(pathname);
  return deckSegments.length === 1 && deckSegments[0] !== "" && deckSegments[0] !== "new";
}

/** `/settings/decks/new` and `/settings/decks/:deckId/edit` are the same deck form component. */
function isDeckEditorRoute(pathname: string): boolean {
  const deckSegments = readDeckRouteSegments(pathname);
  if (deckSegments.length === 1) {
    return deckSegments[0] === "new";
  }

  return deckSegments.length === 2 && deckSegments[0] !== "" && deckSegments[1] === "edit";
}

/**
 * Maps a web route onto the platform-independent surface enum shared with iOS and Android. Routes
 * with no shared surface return null and emit no `screen_viewed`; a route path is never sent.
 *
 * A route that renders no screen maps to null, redirect-only routes included. `/` is a bare
 * `<Navigate replace to={reviewRoute} />`, so counting it as `review` would emit `screen_viewed`
 * twice for every cold start at the site root — permanently, on an append-only table, and only on
 * web, where iOS and Android have no such route. The legacy `/decks`, `/decks/:deckId`,
 * `/decks/:deckId/edit` and `/tags` redirects reach the same null by falling through.
 *
 * Two more kinds of route fall through to null on purpose:
 * - `/dev/previews/...` renders real panels out of a developer harness that only mounts under
 *   `import.meta.env.DEV` or `VITE_ENABLE_DEV_PREVIEWS`. Reporting it would file developer traffic
 *   into the same series as the screen it imitates.
 * - a path no `<Route>` matches renders nothing at all, because the app has no not-found screen.
 *   Every `:param` route here is matched on its segment count for that reason, so `/cards/a/b`,
 *   `/invite/a/b` and `/catalog/import/a/b` report nothing rather than the screen their first
 *   segment looks like. `/settings/...` is the one prefix that stays a catch-all: an unmatched path
 *   under it reports `settings`, which is wrong but cheap, and the alternative is a second copy of
 *   the ~25 settings route patterns here that would drift from `routes.ts`.
 *
 * `/catalog/import/:packageVersionId` is the route's own loading, not-found and error states. The
 * three steps of the install flow behind it are component state rather than routes, so they report
 * themselves through `useAnalyticsScreenView`, as does the sign-in gate a signed-out visitor sees.
 */
export function resolveAnalyticsSurface(pathname: string): AnalyticsSurface | null {
  if (pathname === reviewRoute) {
    return "review";
  }

  if (pathname === cardsRoute) {
    return "cards";
  }

  if (isSingleSegmentRoute(pathname, cardsRoute)) {
    return "card_editor";
  }

  if (pathname === progressRoute) {
    return "progress";
  }

  if (pathname === chatRoute) {
    return "ai";
  }

  if (pathname === shareRoute) {
    return "share";
  }

  if (pathname.startsWith(devPreviewsRoutePrefix)) {
    return null;
  }

  if (isSingleSegmentRoute(pathname, friendInviteRoutePrefix)) {
    return "friend_invite_accept";
  }

  if (isSingleSegmentRoute(pathname, catalogImportRoutePrefix)) {
    return "catalog";
  }

  if (pathname === settingsDecksRoute) {
    return "decks";
  }

  if (isDeckEditorRoute(pathname)) {
    return "deck_editor";
  }

  if (isDeckDetailRoute(pathname)) {
    return "deck_detail";
  }

  if (pathname === settingsTagsRoute) {
    return "tags";
  }

  // Every remaining settings route, the app preference and account leaves included, collapses into
  // `settings` on all three clients. `/settings/test/...` is a test-mode-only harness that sits
  // under the settings screen and is reported as part of it rather than as a screen of its own.
  if (pathname === settingsHubRoute || pathname.startsWith(`${settingsHubRoute}/`)) {
    return "settings";
  }

  return null;
}
