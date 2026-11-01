import type { JSX } from "react";
import { analyticsAreaLabels, analyticsAreas, eventsPath, getAnalyticsAreaPath, usersPath, type AnalyticsArea } from "../routing";
import { AdminLink } from "./AdminLink";

export type AdminNavigationPage = AnalyticsArea | "users" | "events";

const analyticsAreaTestIds: Readonly<Record<AnalyticsArea, string | undefined>> = {
  "level-1-metrics": "analytics-level-1-metrics-tab",
  general: undefined,
  journeys: undefined,
  "review-prompts": "analytics-review-prompts-tab",
  "study-depth": "analytics-study-depth-tab",
  audience: "analytics-audience-tab",
  "ai-usage": "analytics-ai-usage-tab",
};

/** The tab row shared by every analytics area and the Users and Events pages. */
export function AdminNavigation(props: Readonly<{
  activePage: AdminNavigationPage;
  /** Appended to the Level 1 metrics tab's link: a Details page's selection, or empty. */
  levelOneMetricsSearch: string;
  onNavigate: (path: string) => void;
}>): JSX.Element {
  return (
    <nav className="analytics-navigation" aria-label="Admin sections">
      {analyticsAreas.map((area) => (
        <AdminLink
          key={area}
          testId={analyticsAreaTestIds[area]}
          className={props.activePage === area ? "active" : ""}
          path={area === "level-1-metrics" ? `${getAnalyticsAreaPath(area)}${props.levelOneMetricsSearch}` : getAnalyticsAreaPath(area)}
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
      <AdminLink
        testId="admin-events-tab"
        className={props.activePage === "events" ? "active" : ""}
        path={eventsPath}
        ariaCurrent={props.activePage === "events" ? "page" : undefined}
        onNavigate={props.onNavigate}
      >Events</AdminLink>
    </nav>
  );
}
