import {
  cardsRoute,
  chatRoute,
  progressRoute,
  reviewRoute,
  settingsDecksRoute,
  settingsHubRoute,
} from "../routes";
import type { AnalyticsSurface } from "./events";

const catalogImportRoutePrefix = "/catalog/import/";

function isDeckDetailRoute(pathname: string): boolean {
  if (pathname.startsWith(`${settingsDecksRoute}/`) === false) {
    return false;
  }

  const deckSegments = pathname.slice(settingsDecksRoute.length + 1).split("/");
  return deckSegments.length === 1 && deckSegments[0] !== "" && deckSegments[0] !== "new";
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
 */
export function resolveAnalyticsSurface(pathname: string): AnalyticsSurface | null {
  if (pathname === reviewRoute) {
    return "review";
  }

  if (pathname === cardsRoute) {
    return "cards";
  }

  if (pathname.startsWith(`${cardsRoute}/`)) {
    return "card_editor";
  }

  if (pathname === progressRoute) {
    return "progress";
  }

  if (pathname === chatRoute) {
    return "ai";
  }

  if (pathname.startsWith(catalogImportRoutePrefix)) {
    return "catalog";
  }

  if (isDeckDetailRoute(pathname)) {
    return "deck_detail";
  }

  if (pathname === settingsHubRoute || pathname.startsWith(`${settingsHubRoute}/`)) {
    return "settings";
  }

  return null;
}
