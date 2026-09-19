import { useMemo, type JSX } from "react";
import type {
  CatalogInstallsReport,
  DailyActiveUsersReport,
  ReviewEventsByDateReport,
  ReviewEventsByDateUser,
} from "../adminApi";
import { getPackageColorScale } from "../charts/chartPrimitives";
import { formatDateRangeLabel } from "../charts/formatting";
import type { AdminAppConfig } from "../config";
import { AnalyticsFilterBar } from "../filters/AnalyticsFilterBar";
import type { AnalyticsFilterState } from "../filters/analyticsFilters";
import type { AnalyticsFilterOptions } from "../filters/optionsQuery";
import { AdminLink } from "../navigation/AdminLink";
import { AudienceSection } from "../reports/audience/AudienceSection";
import { CatalogInstallFunnelSection } from "../reports/catalogInstallFunnel/CatalogInstallFunnelSection";
import { CatalogInstallsSection } from "../reports/catalogInstalls/CatalogInstallsSection";
import { DailyActiveUsersSection } from "../reports/dailyActiveUsers/DailyActiveUsersSection";
import { ReviewActivitySection } from "../reports/reviewEventsByDate/ReviewActivitySection";
import type { ReviewEventsByDateRange } from "../reports/reviewEventsByDate/query";
import { analyticsAreaLabels, getAnalyticsAreaPath, type AnalyticsArea } from "../routing";
import { getStableUserColorDomain, getUserColorScale } from "./userColors";

export type AdminReportsData = Readonly<{
  availableRange: ReviewEventsByDateRange;
  defaultRange: ReviewEventsByDateRange;
  filterOptions: AnalyticsFilterOptions;
  report: ReviewEventsByDateReport;
  dailyActiveUsersReport: DailyActiveUsersReport;
  catalogInstallsReport: CatalogInstallsReport;
}>;

/**
 * The General report data an analytics area either already has, is still fetching, or failed to
 * fetch. Areas that chart nothing from it, such as Funnels, render without ever leaving the loading
 * branch. A failure is area-local and retryable; only a terminal 401/403 replaces the whole page.
 */
export type AdminReportState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{
      status: "ready";
      data: AdminReportsData;
      isReportLoading: boolean;
      dateRangeError: string;
    }>;

type AnalyticsReportSectionsProps = Readonly<{
  activeArea: AnalyticsArea;
  config: AdminAppConfig;
  data: AdminReportsData;
  filters: AnalyticsFilterState;
  isReportLoading: boolean;
  dateRangeError: string;
  onFiltersChange: (filters: AnalyticsFilterState) => boolean;
  /** Stable across filter changes on purpose; see `App`. */
  onChartUserFilterApply: (userId: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

function buildUserById(
  users: ReadonlyArray<ReviewEventsByDateUser>,
): ReadonlyMap<string, ReviewEventsByDateUser> {
  return new Map<string, ReviewEventsByDateUser>(users.map((user) => [user.userId, user]));
}

function AnalyticsReportSections(props: AnalyticsReportSectionsProps): JSX.Element {
  const report = props.data.report;
  const dailyActiveUsersReport = props.data.dailyActiveUsersReport;
  const catalogInstallsReport = props.data.catalogInstallsReport;
  const filterOptions = props.data.filterOptions;

  const filteredUserById = useMemo(
    () => buildUserById([...report.users, ...report.communityOnlyUsers]),
    [report.communityOnlyUsers, report.users],
  );
  // Both colour domains come from the range-scoped options rather than from the reports on screen,
  // so a person keeps one colour wherever they appear and a deck does not change colour because a
  // filter removed another deck. The options span every section's users, so no section can ask the
  // shared scale for an id it does not hold.
  const userColorScale = useMemo(
    () => getUserColorScale(getStableUserColorDomain(filterOptions.users)),
    [filterOptions.users],
  );
  const packageColorScale = useMemo(
    () => getPackageColorScale(filterOptions.catalogPackageSlugs),
    [filterOptions.catalogPackageSlugs],
  );

  return (
    <>
      <AnalyticsFilterBar
        area={props.activeArea}
        availableRange={props.data.availableRange}
        defaultRange={props.data.defaultRange}
        filters={props.filters}
        userOptions={filterOptions.users}
        isReportLoading={props.isReportLoading}
        dateRangeError={props.dateRangeError}
        userColorScale={userColorScale}
        onFiltersChange={props.onFiltersChange}
      />

      {props.activeArea === "general" ? <>
        <DailyActiveUsersSection
        filteredReport={dailyActiveUsersReport}
        generatedAtUtc={dailyActiveUsersReport.generatedAtUtc}
        userColorScale={userColorScale}
        onUserFilterApply={props.onChartUserFilterApply}
      />

        <CatalogInstallsSection
        filteredReport={catalogInstallsReport}
        generatedAtUtc={catalogInstallsReport.generatedAtUtc}
        packageColorScale={packageColorScale}
      />

        <ReviewActivitySection
        filteredReport={report}
        generatedAtUtc={report.generatedAtUtc}
        filteredUserById={filteredUserById}
        userColorScale={userColorScale}
        onUserFilterApply={props.onChartUserFilterApply}
        />
        </> : <AudienceSection
          config={props.config}
          filters={props.filters}
          isRangeLoading={props.isReportLoading}
          onTerminalAdminError={props.onTerminalAdminError}
        />}
    </>
  );
}

export function AdminDashboard(
  props: Readonly<{
    activeArea: AnalyticsArea;
    onNavigate: (path: string) => void;
    config: AdminAppConfig;
    adminEmail: string;
    reportState: AdminReportState;
    filters: AnalyticsFilterState | null;
    onReportRetry: () => void;
    onFiltersChange: (filters: AnalyticsFilterState) => boolean;
    onChartUserFilterApply: (userId: string) => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  // The range the numbers on screen were produced with, which lags the selection while a reload runs.
  const appliedRange = props.reportState.status === "ready"
    ? { from: props.reportState.data.report.from, to: props.reportState.data.report.to }
    : null;

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin Analytics</p>
          <h1>Product Analytics</h1>
        </div>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          {appliedRange !== null ? <span className="hero-badge">General range {formatDateRangeLabel(appliedRange.from)} to {formatDateRangeLabel(appliedRange.to)}</span> : null}
          <span className="hero-badge">All dates and times in UTC</span>
        </div>
      </section>

      <nav className="analytics-navigation" aria-label="Analytics sections">
        <AdminLink className={props.activeArea === "general" ? "active" : ""} path={getAnalyticsAreaPath("general")} ariaCurrent={props.activeArea === "general" ? "page" : undefined} onNavigate={props.onNavigate}>{analyticsAreaLabels.general}</AdminLink>
        <AdminLink className={props.activeArea === "funnels" ? "active" : ""} path={getAnalyticsAreaPath("funnels")} ariaCurrent={props.activeArea === "funnels" ? "page" : undefined} onNavigate={props.onNavigate}>{analyticsAreaLabels.funnels}</AdminLink>
        <AdminLink testId="analytics-audience-tab" className={props.activeArea === "audience" ? "active" : ""} path={getAnalyticsAreaPath("audience")} ariaCurrent={props.activeArea === "audience" ? "page" : undefined} onNavigate={props.onNavigate}>{analyticsAreaLabels.audience}</AdminLink>
      </nav>

      {props.activeArea === "funnels" ? (
        <CatalogInstallFunnelSection
          config={props.config}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ) : null}

      {props.activeArea !== "funnels" && props.reportState.status === "loading" ? (
        <p className="report-state" aria-live="polite">Loading analytics reports…</p>
      ) : null}

      {props.activeArea !== "funnels" && props.reportState.status === "error" ? (
        <div className="report-state report-state-error">
          <strong>Analytics reports failed to load.</strong>
          <span>{props.reportState.message}</span>
          <button className="filter-button" type="button" onClick={props.onReportRetry}>Retry</button>
        </div>
      ) : null}

      {props.activeArea !== "funnels" && props.reportState.status === "ready" && props.filters !== null ? (
        <AnalyticsReportSections
          activeArea={props.activeArea}
          config={props.config}
          data={props.reportState.data}
          filters={props.filters}
          isReportLoading={props.reportState.isReportLoading}
          dateRangeError={props.reportState.dateRangeError}
          onFiltersChange={props.onFiltersChange}
          onChartUserFilterApply={props.onChartUserFilterApply}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ) : null}
    </main>
  );
}
