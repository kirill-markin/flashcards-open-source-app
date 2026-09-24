export const analyticsAreas = ["general", "funnels", "audience", "ai-usage"] as const;

export type AnalyticsArea = (typeof analyticsAreas)[number];

export const analyticsAreaLabels: Readonly<Record<AnalyticsArea, string>> = {
  general: "General",
  funnels: "Funnels",
  audience: "Audience",
  "ai-usage": "Study vs AI",
};

export type AdminRoute =
  | Readonly<{ kind: "root" }>
  | Readonly<{ kind: "analyticsIndex" }>
  | Readonly<{ kind: "analyticsArea"; area: AnalyticsArea }>
  | Readonly<{ kind: "notFound"; pathname: string }>;

export const rootPath = "/";

export const analyticsIndexPath = "/analytics";

export function getAnalyticsAreaPath(area: AnalyticsArea): string {
  return `${analyticsIndexPath}/${area}`;
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
    case "notFound":
      return route.pathname;
  }
}

function stripTrailingSlashes(pathname: string): string {
  const trimmedPathname = pathname.replace(/\/+$/u, "");
  return trimmedPathname === "" ? rootPath : trimmedPathname;
}

export function parseAdminRoute(pathname: string): AdminRoute {
  const normalizedPathname = stripTrailingSlashes(pathname);

  if (normalizedPathname === rootPath) {
    return { kind: "root" };
  }

  if (normalizedPathname === analyticsIndexPath) {
    return { kind: "analyticsIndex" };
  }

  const area = analyticsAreas.find(
    (candidateArea) => getAnalyticsAreaPath(candidateArea) === normalizedPathname,
  );
  if (area !== undefined) {
    return { kind: "analyticsArea", area };
  }

  return { kind: "notFound", pathname };
}
