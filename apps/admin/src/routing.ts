import { reviewPromptIds, type ReviewPromptId } from "./reports/reviewPrompts/reviewPromptDefinitions";

export const analyticsAreas = [
  "level-1-metrics",
  "journeys",
  "review-prompts",
  "study-depth",
  "general",
  "audience",
  "ai-usage",
] as const;

export type AnalyticsArea = (typeof analyticsAreas)[number];

/** Where `/` and `/analytics` land. */
export const defaultAnalyticsArea: AnalyticsArea = "level-1-metrics";

export const analyticsAreaLabels: Readonly<Record<AnalyticsArea, string>> = {
  "level-1-metrics": "Level 1 metrics",
  general: "General",
  journeys: "Journeys",
  "review-prompts": "Review prompts",
  "study-depth": "Study depth",
  audience: "Audience",
  "ai-usage": "Study vs AI",
};

/** The Level 1 charts that have a Details page, by the slug of its path. */
export const levelOneMetricDetails = ["who-saw-us", "who-opened-the-app", "who-studied", "who-paid-us"] as const;

export type LevelOneMetricDetail = (typeof levelOneMetricDetails)[number];

/** The funnels that have a Details page, by their `FunnelAnchor.funnelId`, which is also the slug of its path. */
export const funnelDetails = ["first-launch"] as const;

export type FunnelDetail = (typeof funnelDetails)[number];

/** The Who saw us datasets with a page of their own under its Details picker, by the slug of its path. */
export const whoSawUsDatasets = ["web", "app-store", "google-play"] as const;

export type WhoSawUsDataset = (typeof whoSawUsDatasets)[number];

export const userPageTabs = ["profile", "activity", "chats", "cards"] as const;

export type UserPageTab = (typeof userPageTabs)[number];

export const userPageTabLabels: Readonly<Record<UserPageTab, string>> = {
  profile: "Profile",
  activity: "Activity",
  chats: "Chats",
  cards: "Cards",
};

export type AdminRoute =
  | Readonly<{ kind: "analyticsArea"; area: AnalyticsArea }>
  | Readonly<{ kind: "levelOneMetricDetails"; metric: LevelOneMetricDetail }>
  | Readonly<{ kind: "whoSawUsDataset"; dataset: WhoSawUsDataset }>
  | Readonly<{ kind: "funnelDetails"; funnelId: FunnelDetail }>
  /** The Journeys Retention card's Details page. */
  | Readonly<{ kind: "retentionDetails" }>
  | Readonly<{ kind: "reviewPromptDetails"; promptId: ReviewPromptId }>
  | Readonly<{ kind: "users" }>
  | Readonly<{ kind: "user"; userId: string; tab: UserPageTab }>
  /** One chat opened from the Chats tab, a path of its own so Back returns to the list. */
  | Readonly<{ kind: "userChat"; userId: string; sessionId: string }>
  | Readonly<{ kind: "events" }>
  | Readonly<{ kind: "event"; eventId: string }>
  | Readonly<{ kind: "notFound"; pathname: string }>;

const rootPath = "/";

const analyticsIndexPath = "/analytics";

export const usersPath = "/users";

export const eventsPath = "/events";

export function getAnalyticsAreaPath(area: AnalyticsArea): string {
  return `${analyticsIndexPath}/${area}`;
}

export function getLevelOneMetricDetailsPath(metric: LevelOneMetricDetail): string {
  return `${getAnalyticsAreaPath("level-1-metrics")}/${metric}`;
}

export function getWhoSawUsDatasetPath(dataset: WhoSawUsDataset): string {
  return `${getLevelOneMetricDetailsPath("who-saw-us")}/${dataset}`;
}

export function getFunnelDetailsPath(funnelId: FunnelDetail): string {
  return `${getAnalyticsAreaPath("journeys")}/${funnelId}`;
}

export const retentionDetailsPath = `${getAnalyticsAreaPath("journeys")}/retention`;

export function getReviewPromptDetailsPath(promptId: ReviewPromptId): string {
  return `${getAnalyticsAreaPath("review-prompts")}/${promptId}`;
}

/** The funnel's Details page id, or `undefined` for a funnel that has none. */
export function findFunnelDetail(funnelId: string): FunnelDetail | undefined {
  return funnelDetails.find((candidateFunnelId) => candidateFunnelId === funnelId);
}

/** `userId` is a raw `org.user_settings.user_id` or an analytics `actor_id`, encoded as one segment. */
export function getUserPath(userId: string, tab: UserPageTab): string {
  return `${usersPath}/${encodeURIComponent(userId)}/${tab}`;
}

export function getUserChatPath(userId: string, sessionId: string): string {
  return `${getUserPath(userId, "chats")}/${encodeURIComponent(sessionId)}`;
}

/** `eventId` is an `analytics.product_events_resolved.event_id`, encoded as one segment. */
export function getEventPath(eventId: string): string {
  return `${eventsPath}/${encodeURIComponent(eventId)}`;
}

/**
 * Canonical path of a route. An unknown path is its own canonical form, so a not-found URL is shown
 * as the visitor typed it instead of being rewritten.
 */
export function getAdminRoutePath(route: AdminRoute): string {
  switch (route.kind) {
    case "analyticsArea":
      return getAnalyticsAreaPath(route.area);
    case "levelOneMetricDetails":
      return getLevelOneMetricDetailsPath(route.metric);
    case "whoSawUsDataset":
      return getWhoSawUsDatasetPath(route.dataset);
    case "funnelDetails":
      return getFunnelDetailsPath(route.funnelId);
    case "retentionDetails":
      return retentionDetailsPath;
    case "reviewPromptDetails":
      return getReviewPromptDetailsPath(route.promptId);
    case "users":
      return usersPath;
    case "user":
      return getUserPath(route.userId, route.tab);
    case "userChat":
      return getUserChatPath(route.userId, route.sessionId);
    case "events":
      return eventsPath;
    case "event":
      return getEventPath(route.eventId);
    case "notFound":
      return route.pathname;
  }
}

function stripTrailingSlashes(pathname: string): string {
  const trimmedPathname = pathname.replace(/\/+$/u, "");
  return trimmedPathname === "" ? rootPath : trimmedPathname;
}

const userPathPattern = /^\/users\/([^/]+)(?:\/([^/]+))?$/u;

const userChatPathPattern = /^\/users\/([^/]+)\/chats\/([^/]+)$/u;

/** A user path without a tab opens the Profile tab, whose path is then the canonical one. */
function parseUserRoute(normalizedPathname: string): AdminRoute | null {
  try {
    const chatMatch = userChatPathPattern.exec(normalizedPathname);
    if (chatMatch !== null) {
      return { kind: "userChat", userId: decodeURIComponent(chatMatch[1]), sessionId: decodeURIComponent(chatMatch[2]) };
    }
    const match = userPathPattern.exec(normalizedPathname);
    if (match === null) {
      return null;
    }
    const tab = match[2] === undefined ? "profile" : userPageTabs.find((candidateTab) => candidateTab === match[2]);
    if (tab === undefined) {
      return null;
    }
    return { kind: "user", userId: decodeURIComponent(match[1]), tab };
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

const eventPathPattern = /^\/events\/([^/]+)$/u;

function parseEventRoute(normalizedPathname: string): AdminRoute | null {
  const match = eventPathPattern.exec(normalizedPathname);
  if (match === null) {
    return null;
  }
  try {
    return { kind: "event", eventId: decodeURIComponent(match[1]) };
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

/** The Journeys area's former path, which shared links still carry. */
const legacyJourneysPathPattern = /^\/analytics\/funnels(?=\/|$)/u;

/** The former Level 1 Details page of the retention charts, which shared links still carry. */
const legacyRetentionDetailsPath = `${getAnalyticsAreaPath("level-1-metrics")}/who-came-back`;

/**
 * `/` and `/analytics` parse to the default area, a legacy `/analytics/funnels…` path to the
 * Journeys route at the same place, and the legacy retention Details path to the Retention Details
 * page, so canonicalizing the path is their redirect.
 */
export function parseAdminRoute(pathname: string): AdminRoute {
  const strippedPathname = stripTrailingSlashes(pathname)
    .replace(legacyJourneysPathPattern, getAnalyticsAreaPath("journeys"));
  const normalizedPathname = strippedPathname === legacyRetentionDetailsPath ? retentionDetailsPath : strippedPathname;

  if (normalizedPathname === rootPath || normalizedPathname === analyticsIndexPath) {
    return { kind: "analyticsArea", area: defaultAnalyticsArea };
  }

  if (normalizedPathname === usersPath) {
    return { kind: "users" };
  }

  const userRoute = parseUserRoute(normalizedPathname);
  if (userRoute !== null) {
    return userRoute;
  }

  if (normalizedPathname === eventsPath) {
    return { kind: "events" };
  }

  const eventRoute = parseEventRoute(normalizedPathname);
  if (eventRoute !== null) {
    return eventRoute;
  }

  const area = analyticsAreas.find(
    (candidateArea) => getAnalyticsAreaPath(candidateArea) === normalizedPathname,
  );
  if (area !== undefined) {
    return { kind: "analyticsArea", area };
  }

  const metric = levelOneMetricDetails.find(
    (candidateMetric) => getLevelOneMetricDetailsPath(candidateMetric) === normalizedPathname,
  );
  if (metric !== undefined) {
    return { kind: "levelOneMetricDetails", metric };
  }

  const dataset = whoSawUsDatasets.find(
    (candidateDataset) => getWhoSawUsDatasetPath(candidateDataset) === normalizedPathname,
  );
  if (dataset !== undefined) {
    return { kind: "whoSawUsDataset", dataset };
  }

  if (normalizedPathname === retentionDetailsPath) {
    return { kind: "retentionDetails" };
  }

  const funnelId = funnelDetails.find(
    (candidateFunnelId) => getFunnelDetailsPath(candidateFunnelId) === normalizedPathname,
  );
  if (funnelId !== undefined) {
    return { kind: "funnelDetails", funnelId };
  }

  const promptId = reviewPromptIds.find(
    (candidatePromptId) => getReviewPromptDetailsPath(candidatePromptId) === normalizedPathname,
  );
  if (promptId !== undefined) {
    return { kind: "reviewPromptDetails", promptId };
  }

  return { kind: "notFound", pathname };
}
