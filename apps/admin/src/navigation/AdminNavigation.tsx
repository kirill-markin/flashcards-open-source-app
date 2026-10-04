import type { JSX } from "react";
import { analyticsAreaLabels, analyticsAreas, getAnalyticsAreaPath, usersPath, type AnalyticsArea } from "../routing";
import { AdminLink } from "./AdminLink";

export type AdminNavigationPage = AnalyticsArea | "users";

const analyticsAreaTestIds: Readonly<Record<AnalyticsArea, string | undefined>> = {
  general: undefined,
  funnels: undefined,
  audience: "analytics-audience-tab",
  "ai-usage": "analytics-ai-usage-tab",
};

/** The tab row shared by every analytics area and the Users page; `null` on a page no tab owns. */
export function AdminNavigation(props: Readonly<{
  activePage: AdminNavigationPage | null;
  onNavigate: (path: string) => void;
}>): JSX.Element {
  return (
    <nav className="analytics-navigation" aria-label="Admin sections">
      {analyticsAreas.map((area) => (
        <AdminLink
          key={area}
          testId={analyticsAreaTestIds[area]}
          className={props.activePage === area ? "active" : ""}
          path={getAnalyticsAreaPath(area)}
          ariaCurrent={props.activePage === area ? "page" : undefined}
          onNavigate={props.onNavigate}
        >{analyticsAreaLabels[area]}</AdminLink>
      ))}
      <AdminLink
        testId="admin-users-tab"
        className={props.activePage === "users" ? "active" : ""}
        path={usersPath}
        ariaCurrent={props.activePage === "users" ? "page" : undefined}
        onNavigate={props.onNavigate}
      >Users</AdminLink>
    </nav>
  );
}
