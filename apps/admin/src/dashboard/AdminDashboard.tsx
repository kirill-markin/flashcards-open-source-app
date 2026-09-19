import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type {
  CatalogInstallsReport,
  DailyActiveUsersReport,
  ReviewEventCohort,
  ReviewEventPlatform,
  ReviewEventsByDateReport,
  ReviewEventsByDateUser,
} from "../adminApi";
import { getPackageColorScale } from "../charts/chartPrimitives";
import { formatDateRangeLabel } from "../charts/formatting";
import type { AdminAppConfig } from "../config";
import {
  buildDefaultAnalyticsFilterState,
  type AnalyticsFilterState,
} from "../filters/analyticsFilters";
import type { AnalyticsFilterOptions } from "../filters/optionsQuery";
import { AdminLink } from "../navigation/AdminLink";
import { AudienceSection } from "../reports/audience/AudienceSection";
import { CatalogInstallFunnelSection } from "../reports/catalogInstallFunnel/CatalogInstallFunnelSection";
import { CatalogInstallsSection } from "../reports/catalogInstalls/CatalogInstallsSection";
import { DailyActiveUsersSection } from "../reports/dailyActiveUsers/DailyActiveUsersSection";
import {
  buildPresetReportRange,
  lastThreeDaysReportRangePreset,
  reportRangePresetLabel,
} from "../reports/reportValues";
import { ReviewActivitySection } from "../reports/reviewEventsByDate/ReviewActivitySection";
import { ReviewEventsByDateFilters } from "../reports/reviewEventsByDate/filters/ReviewEventsByDateFilters";
import {
  buildActiveUserFilters,
  buildSearchableUserFilterOptions,
  doesUserMatchSearch,
  getNormalizedSearchValue,
  visibleUserFilterOptionLimit,
} from "../reports/reviewEventsByDate/filters/userFilters";
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
  draftRange: ReviewEventsByDateRange;
  userFilterSearchValue: string;
  onDraftRangeChange: (range: ReviewEventsByDateRange) => void;
  onFiltersChange: (filters: AnalyticsFilterState) => boolean;
  onUserFilterSearchChange: (searchValue: string) => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

function buildUserById(
  users: ReadonlyArray<ReviewEventsByDateUser>,
): ReadonlyMap<string, ReviewEventsByDateUser> {
  return new Map<string, ReviewEventsByDateUser>(users.map((user) => [user.userId, user]));
}

function getUpdatedUserFilterSelection(
  currentUserIds: ReadonlyArray<string>,
  userId: string,
  isChecked: boolean,
): ReadonlyArray<string> {
  if (isChecked) {
    if (currentUserIds.includes(userId)) {
      return currentUserIds;
    }

    return [...currentUserIds, userId];
  }

  return currentUserIds.filter((currentUserId) => currentUserId !== userId);
}

function getUpdatedCohortFilterSelection(
  currentCohorts: ReadonlyArray<ReviewEventCohort>,
  cohort: ReviewEventCohort,
  isChecked: boolean,
): ReadonlyArray<ReviewEventCohort> {
  if (isChecked) {
    if (currentCohorts.includes(cohort)) {
      return currentCohorts;
    }

    return [...currentCohorts, cohort];
  }

  return currentCohorts.filter((currentCohort) => currentCohort !== cohort);
}

function getUpdatedPlatformFilterSelection(
  currentPlatforms: ReadonlyArray<ReviewEventPlatform>,
  platform: ReviewEventPlatform,
  isChecked: boolean,
): ReadonlyArray<ReviewEventPlatform> {
  if (isChecked) {
    if (currentPlatforms.includes(platform)) {
      return currentPlatforms;
    }

    return [...currentPlatforms, platform];
  }

  return currentPlatforms.filter((currentPlatform) => currentPlatform !== platform);
}

function AnalyticsReportSections(props: AnalyticsReportSectionsProps): JSX.Element {
  function handleFromDateChange(from: string): void {
    props.onDraftRangeChange({
      ...props.draftRange,
      from,
    });
  }

  function handleToDateChange(to: string): void {
    props.onDraftRangeChange({
      ...props.draftRange,
      to,
    });
  }

  function applyDateRange(range: ReviewEventsByDateRange): boolean {
    return props.onFiltersChange({ ...props.filters, dateRange: range });
  }

  /** Whether the typed range was accepted; a rejected one leaves the popover open on its error. */
  function handleDateRangeSubmit(): boolean {
    return applyDateRange(props.draftRange);
  }

  function handleDateRangeReset(): void {
    props.onDraftRangeChange(props.data.defaultRange);
    applyDateRange(props.data.defaultRange);
  }

  function handleDateRangePresetSelect(range: ReviewEventsByDateRange): void {
    props.onDraftRangeChange(range);
    applyDateRange(range);
  }

  function handleLastThreeDays(): void {
    handleDateRangePresetSelect(buildPresetReportRange(
      lastThreeDaysReportRangePreset,
      props.data.availableRange,
      reportRangePresetLabel,
    ));
  }

  function handleUserFilterChange(userId: string, isChecked: boolean): void {
    props.onFiltersChange({
      ...props.filters,
      users: getUpdatedUserFilterSelection(props.filters.users, userId, isChecked),
    });
  }

  function handleUserFilterRemove(userId: string): void {
    props.onFiltersChange({
      ...props.filters,
      users: props.filters.users.filter((currentUserId) => currentUserId !== userId),
    });
  }

  function handleUserFilterClear(): void {
    props.onFiltersChange({ ...props.filters, users: [] });
  }

  function handleCohortFilterChange(cohort: ReviewEventCohort, isChecked: boolean): void {
    props.onFiltersChange({
      ...props.filters,
      userCohorts: getUpdatedCohortFilterSelection(props.filters.userCohorts, cohort, isChecked),
    });
  }

  function handlePlatformFilterChange(platform: ReviewEventPlatform, isChecked: boolean): void {
    props.onFiltersChange({
      ...props.filters,
      eventPlatforms: getUpdatedPlatformFilterSelection(props.filters.eventPlatforms, platform, isChecked),
    });
  }

  function handleAllFiltersReset(): void {
    props.onDraftRangeChange(props.data.defaultRange);
    props.onUserFilterSearchChange("");
    props.onFiltersChange(buildDefaultAnalyticsFilterState(props.data.defaultRange));
  }

  const filters = props.filters;
  const onFiltersChange = props.onFiltersChange;
  const handleChartUserFilterApply = useCallback((userId: string): void => {
    onFiltersChange({ ...filters, users: [userId] });
  }, [filters, onFiltersChange]);

  const report = props.data.report;
  const dailyActiveUsersReport = props.data.dailyActiveUsersReport;
  const catalogInstallsReport = props.data.catalogInstallsReport;
  const filterOptions = props.data.filterOptions;

  const selectedUserIdSet = useMemo(
    () => new Set(filters.users),
    [filters.users],
  );
  const selectedCohortSet = useMemo(
    () => new Set(filters.userCohorts),
    [filters.userCohorts],
  );
  const selectedPlatformSet = useMemo(
    () => new Set(filters.eventPlatforms),
    [filters.eventPlatforms],
  );
  const reportUserById = useMemo(
    () => buildUserById(filterOptions.users),
    [filterOptions.users],
  );
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
  const activeUserFilters = useMemo(
    () => buildActiveUserFilters(filters.users, reportUserById),
    [filters.users, reportUserById],
  );
  const normalizedUserFilterSearchValue = useMemo(
    () => getNormalizedSearchValue(props.userFilterSearchValue),
    [props.userFilterSearchValue],
  );
  const searchableUserFilterOptions = useMemo(
    () => buildSearchableUserFilterOptions(filterOptions.users),
    [filterOptions.users],
  );
  const matchingUserFilterOptions = useMemo(
    () => searchableUserFilterOptions
      .filter((option) => doesUserMatchSearch(option, normalizedUserFilterSearchValue))
      .map((option) => option.user),
    [normalizedUserFilterSearchValue, searchableUserFilterOptions],
  );
  const visibleUserFilterOptions = useMemo(
    () => matchingUserFilterOptions.slice(0, visibleUserFilterOptionLimit),
    [matchingUserFilterOptions],
  );
  const hiddenUserFilterOptionCount = matchingUserFilterOptions.length - visibleUserFilterOptions.length;

  return (
    <>
      <ReviewEventsByDateFilters
        availableRange={props.data.availableRange}
        defaultRange={props.data.defaultRange}
        appliedRange={{
          from: report.from,
          to: report.to,
        }}
        draftRange={props.draftRange}
        isReportLoading={props.isReportLoading}
        dateRangeError={props.dateRangeError}
        reportUsers={filterOptions.users}
        selectedUserIds={filters.users}
        selectedUserIdSet={selectedUserIdSet}
        selectedCohorts={filters.userCohorts}
        selectedCohortSet={selectedCohortSet}
        selectedPlatforms={filters.eventPlatforms}
        selectedPlatformSet={selectedPlatformSet}
        userFilterSearchValue={props.userFilterSearchValue}
        visibleUserFilterOptions={visibleUserFilterOptions}
        matchingUserFilterOptionCount={matchingUserFilterOptions.length}
        hiddenUserFilterOptionCount={hiddenUserFilterOptionCount}
        activeUserFilters={activeUserFilters}
        userColorScale={userColorScale}
        onFromDateChange={handleFromDateChange}
        onToDateChange={handleToDateChange}
        onDateRangeSubmit={handleDateRangeSubmit}
        onDateRangePresetSelect={handleDateRangePresetSelect}
        onDateRangeReset={handleDateRangeReset}
        onUserFilterSearchChange={props.onUserFilterSearchChange}
        onUserFilterChange={handleUserFilterChange}
        onUserFilterRemove={handleUserFilterRemove}
        onUserFilterClear={handleUserFilterClear}
        onCohortFilterChange={handleCohortFilterChange}
        onPlatformFilterChange={handlePlatformFilterChange}
        onAllFiltersReset={handleAllFiltersReset}
      />

      {props.activeArea === "general" ? <>
        <DailyActiveUsersSection
        filteredReport={dailyActiveUsersReport}
        generatedAtUtc={dailyActiveUsersReport.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
      />

        <CatalogInstallsSection
        filteredReport={catalogInstallsReport}
        generatedAtUtc={catalogInstallsReport.generatedAtUtc}
        packageColorScale={packageColorScale}
      />

        <ReviewActivitySection
        filteredReport={report}
        generatedAtUtc={report.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        filteredUserById={filteredUserById}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
        />
        </> : <AudienceSection
          config={props.config}
          filters={props.filters}
          isRangeLoading={props.isReportLoading}
          onLastThreeDays={handleLastThreeDays}
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
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  // The draft range is the picker's own unapplied state, so it stays here rather than in the filter
  // selection; a null one follows the applied range of the loaded report.
  const [draftRange, setDraftRange] = useState<ReviewEventsByDateRange | null>(null);
  const [userFilterSearchValue, setUserFilterSearchValue] = useState<string>("");

  const appliedRange = props.reportState.status === "ready"
    ? { from: props.reportState.data.report.from, to: props.reportState.data.report.to }
    : null;
  const appliedFrom = appliedRange === null ? null : appliedRange.from;
  const appliedTo = appliedRange === null ? null : appliedRange.to;

  useEffect(() => {
    if (appliedFrom === null || appliedTo === null) {
      return;
    }

    setDraftRange({
      from: appliedFrom,
      to: appliedTo,
    });
  }, [appliedFrom, appliedTo]);

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
          draftRange={draftRange ?? {
            from: props.reportState.data.report.from,
            to: props.reportState.data.report.to,
          }}
          userFilterSearchValue={userFilterSearchValue}
          onDraftRangeChange={setDraftRange}
          onFiltersChange={props.onFiltersChange}
          onUserFilterSearchChange={setUserFilterSearchValue}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ) : null}
    </main>
  );
}
