export const analyticsAreas = ["general", "funnels", "audience", "ai-usage"] as const;

export type AnalyticsArea = (typeof analyticsAreas)[number];

export const analyticsAreaLabels: Readonly<Record<AnalyticsArea, string>> = {
  general: "General",
  funnels: "Funnels",
  audience: "Audience",
  "ai-usage": "Study vs AI",
};

export const userPageTabs = ["profile", "activity"] as const;

export type UserPageTab = (typeof userPageTabs)[number];

export const userPageTabLabels: Readonly<Record<UserPageTab, string>> = {
  profile: "Profile",
  activity: "Activity",
};

export type AdminRoute =
  | Readonly<{ kind: "root" }>
  | Readonly<{ kind: "analyticsIndex" }>
  | Readonly<{ kind: "analyticsArea"; area: AnalyticsArea }>
  | Readonly<{ kind: "users" }>
  | Readonly<{ kind: "user"; userId: string; tab: UserPageTab }>
  | Readonly<{ kind: "notFound"; pathname: string }>;

export const rootPath = "/";

export const analyticsIndexPath = "/analytics";

export const usersPath = "/users";

export function getAnalyticsAreaPath(area: AnalyticsArea): string {
  return `${analyticsIndexPath}/${area}`;
}

/** `userId` is a raw `org.user_settings.user_id` or an analytics `actor_id`, encoded as one segment. */
export function getUserPath(userId: string, tab: UserPageTab): string {
  return `${usersPath}/${encodeURIComponent(userId)}/${tab}`;
}

/**
 * Canonical path of a route. An unknown path is its own canonical form, so a not-found URL is shown
 * as the visitor typed it instead of being rewritten.
 */
export function getAdminRoutePath(route: AdminRoute): string {
  switch (route.kind) {
    case "root":
      return rootPath;
    case "analyticsIndex":
      return analyticsIndexPath;
    case "analyticsArea":
      return getAnalyticsAreaPath(route.area);
    case "users":
      return usersPath;
    case "user":
      return getUserPath(route.userId, route.tab);
    case "notFound":
      return route.pathname;
  }
}

function stripTrailingSlashes(pathname: string): string {
  const trimmedPathname = pathname.replace(/\/+$/u, "");
  return trimmedPathname === "" ? rootPath : trimmedPathname;
}

const userPathPattern = /^\/users\/([^/]+)(?:\/([^/]+))?$/u;

/** A user path without a tab opens the Profile tab, whose path is then the canonical one. */
function parseUserRoute(normalizedPathname: string): AdminRoute | null {
  const match = userPathPattern.exec(normalizedPathname);
  if (match === null) {
    return null;
  }
  const tab = match[2] === undefined ? "profile" : userPageTabs.find((candidateTab) => candidateTab === match[2]);
  if (tab === undefined) {
    return null;
  }
  try {
    return { kind: "user", userId: decodeURIComponent(match[1]), tab };
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

export function parseAdminRoute(pathname: string): AdminRoute {
  const normalizedPathname = stripTrailingSlashes(pathname);

  if (normalizedPathname === rootPath) {
    return { kind: "root" };
  }

  if (normalizedPathname === analyticsIndexPath) {
    return { kind: "analyticsIndex" };
  }

  if (normalizedPathname === usersPath) {
    return { kind: "users" };
  }

  const userRoute = parseUserRoute(normalizedPathname);
  if (userRoute !== null) {
    return userRoute;
  }

  const area = analyticsAreas.find(
    (candidateArea) => getAnalyticsAreaPath(candidateArea) === normalizedPathname,
  );
  if (area !== undefined) {
    return { kind: "analyticsArea", area };
  }

  return { kind: "notFound", pathname };
}
