import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type CatalogInstallsReport,
  type CatalogInstallsUser,
  type DailyActiveUsersReport,
  type DailyActiveUsersUser,
  type ReviewEventCohort,
  type ReviewEventPlatform,
  type ReviewEventsByDateReport,
  type ReviewEventsByDateUser,
} from "../adminApi";
import { getPackageColorScale } from "../charts/chartPrimitives";
import { formatDateRangeLabel } from "../charts/formatting";
import type { AdminAppConfig } from "../config";
import { AdminLink } from "../navigation/AdminLink";
import { AudienceSection } from "../reports/audience/AudienceSection";
import { CatalogInstallFunnelSection } from "../reports/catalogInstallFunnel/CatalogInstallFunnelSection";
import { CatalogInstallsSection } from "../reports/catalogInstalls/CatalogInstallsSection";
import { filterCatalogInstallsReport } from "../reports/catalogInstalls/query";
import { DailyActiveUsersSection } from "../reports/dailyActiveUsers/DailyActiveUsersSection";
import { filterDailyActiveUsersReport } from "../reports/dailyActiveUsers/query";
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
import {
  filterReviewEventsByDateReport,
  type ReviewEventsByDateRange,
} from "../reports/reviewEventsByDate/query";
import { analyticsAreaLabels, getAnalyticsAreaPath, type AnalyticsArea } from "../routing";
import { getStableUserColorDomain, getUserColorScale } from "./userColors";

export type AdminReportsData = Readonly<{
  availableRange: ReviewEventsByDateRange;
  defaultRange: ReviewEventsByDateRange;
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
  isReportLoading: boolean;
  dateRangeError: string;
  draftRange: ReviewEventsByDateRange;
  selectedUserIds: ReadonlyArray<string>;
  selectedCohorts: ReadonlyArray<ReviewEventCohort>;
  selectedPlatforms: ReadonlyArray<ReviewEventPlatform>;
  userFilterSearchValue: string;
  onDraftRangeChange: (range: ReviewEventsByDateRange) => void;
  onSelectedUserIdsChange: (userIds: ReadonlyArray<string>) => void;
  onSelectedCohortsChange: (cohorts: ReadonlyArray<ReviewEventCohort>) => void;
  onSelectedPlatformsChange: (platforms: ReadonlyArray<ReviewEventPlatform>) => void;
  onUserFilterSearchChange: (searchValue: string) => void;
  onDateRangeApply: (range: ReviewEventsByDateRange) => void;
  onDateRangeReset: () => void;
  onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
}>;

function buildUserFilterOptionUsers(
  reviewUsers: ReadonlyArray<ReviewEventsByDateUser>,
  communityOnlyUsers: ReadonlyArray<ReviewEventsByDateUser>,
  activeUsers: ReadonlyArray<DailyActiveUsersUser>,
  installerUsers: ReadonlyArray<CatalogInstallsUser>,
): ReadonlyArray<ReviewEventsByDateUser> {
  const usersByUserId = new Map<string, ReviewEventsByDateUser>(
    [...reviewUsers, ...communityOnlyUsers].map((user) => [user.userId, user]),
  );

  for (const user of [...activeUsers, ...installerUsers]) {
    if (usersByUserId.has(user.userId)) {
      continue;
    }

    usersByUserId.set(user.userId, {
      userId: user.userId,
      email: user.email,
      totalReviewEvents: 0,
    });
  }

  return Array.from(usersByUserId.values());
}

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

  function handleDateRangeSubmit(): void {
    props.onDateRangeApply(props.draftRange);
  }

  function handleDateRangeReset(): void {
    props.onDraftRangeChange(props.data.defaultRange);
    props.onDateRangeReset();
  }

  function handleDateRangePresetSelect(range: ReviewEventsByDateRange): void {
    props.onDraftRangeChange(range);
    props.onDateRangeApply(range);
  }

  function handleLastThreeDays(): void {
    handleDateRangePresetSelect(buildPresetReportRange(
      lastThreeDaysReportRangePreset,
      props.data.availableRange,
      reportRangePresetLabel,
    ));
  }

  function handleUserFilterChange(userId: string, isChecked: boolean): void {
    props.onSelectedUserIdsChange(getUpdatedUserFilterSelection(props.selectedUserIds, userId, isChecked));
  }

  function handleUserFilterRemove(userId: string): void {
    props.onSelectedUserIdsChange(props.selectedUserIds.filter((currentUserId) => currentUserId !== userId));
  }

  function handleUserFilterClear(): void {
    props.onSelectedUserIdsChange([]);
  }

  function handleCohortFilterChange(cohort: ReviewEventCohort, isChecked: boolean): void {
    props.onSelectedCohortsChange(getUpdatedCohortFilterSelection(props.selectedCohorts, cohort, isChecked));
  }

  function handlePlatformFilterChange(platform: ReviewEventPlatform, isChecked: boolean): void {
    props.onSelectedPlatformsChange(getUpdatedPlatformFilterSelection(props.selectedPlatforms, platform, isChecked));
  }

  function handleAllFiltersReset(): void {
    props.onDraftRangeChange(props.data.defaultRange);
    props.onSelectedUserIdsChange([]);
    props.onSelectedCohortsChange([...reviewEventCohorts]);
    props.onSelectedPlatformsChange([...reviewEventPlatforms]);
    props.onUserFilterSearchChange("");
    props.onDateRangeReset();
  }

  const onSelectedUserIdsChange = props.onSelectedUserIdsChange;
  const handleChartUserFilterApply = useCallback((userId: string): void => {
    onSelectedUserIdsChange([userId]);
  }, [onSelectedUserIdsChange]);

  const report = props.data.report;
  const dailyActiveUsersReport = props.data.dailyActiveUsersReport;
  const catalogInstallsReport = props.data.catalogInstallsReport;
  const selectedUserIds = props.selectedUserIds;
  const selectedCohorts = props.selectedCohorts;
  const selectedPlatforms = props.selectedPlatforms;

  const filteredReport = useMemo(
    () => filterReviewEventsByDateReport(report, {
      selectedUserIds,
      selectedCohorts,
      selectedPlatforms,
    }),
    [report, selectedCohorts, selectedPlatforms, selectedUserIds],
  );
  const filteredDailyActiveUsersReport = useMemo(
    () => filterDailyActiveUsersReport(dailyActiveUsersReport, {
      selectedUserIds,
      selectedCohorts,
      selectedPlatforms,
    }),
    [dailyActiveUsersReport, selectedCohorts, selectedPlatforms, selectedUserIds],
  );
  // The cohort split comes from the unfiltered daily active users report, so narrowing a filter
  // cannot change which day an installer counts as new on.
  const filteredCatalogInstallsReport = useMemo(
    () => filterCatalogInstallsReport(catalogInstallsReport, {
      selectedUserIds,
      selectedCohorts,
      selectedPlatforms,
      firstActiveDateByUserId: dailyActiveUsersReport.firstActiveDateByUserId,
    }),
    [
      catalogInstallsReport,
      dailyActiveUsersReport.firstActiveDateByUserId,
      selectedCohorts,
      selectedPlatforms,
      selectedUserIds,
    ],
  );
  const selectedUserIdSet = useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds],
  );
  const selectedCohortSet = useMemo(
    () => new Set(selectedCohorts),
    [selectedCohorts],
  );
  const selectedPlatformSet = useMemo(
    () => new Set(selectedPlatforms),
    [selectedPlatforms],
  );
  const userFilterOptionUsers = useMemo(
    () => buildUserFilterOptionUsers(
      report.users,
      report.communityOnlyUsers,
      dailyActiveUsersReport.users,
      catalogInstallsReport.users,
    ),
    [
      catalogInstallsReport.users,
      dailyActiveUsersReport.users,
      report.communityOnlyUsers,
      report.users,
    ],
  );
  const reportUserById = useMemo(
    () => buildUserById(userFilterOptionUsers),
    [userFilterOptionUsers],
  );
  const filteredUserById = useMemo(
    () => buildUserById([...filteredReport.users, ...filteredReport.communityOnlyUsers]),
    [filteredReport.communityOnlyUsers, filteredReport.users],
  );
  // The domain is the union of every section's own user list, so a person keeps one colour wherever
  // they appear and no section can ever ask the shared scale for an id it does not hold.
  const userColorScale = useMemo(
    () => getUserColorScale(getStableUserColorDomain([
      ...report.users,
      ...report.communityOnlyUsers,
      ...dailyActiveUsersReport.users,
      ...catalogInstallsReport.users,
    ])),
    [
      catalogInstallsReport.users,
      dailyActiveUsersReport.users,
      report.communityOnlyUsers,
      report.users,
    ],
  );
  // Built from the loaded report rather than the filtered one, for the same reason the user colour
  // domain is: a deck must not change colour because a filter removed another deck.
  const packageColorScale = useMemo(
    () => getPackageColorScale(
      catalogInstallsReport.packages.map((catalogPackage) => catalogPackage.packageSlug),
    ),
    [catalogInstallsReport.packages],
  );
  const activeUserFilters = useMemo(
    () => buildActiveUserFilters(selectedUserIds, reportUserById),
    [selectedUserIds, reportUserById],
  );
  const normalizedUserFilterSearchValue = useMemo(
    () => getNormalizedSearchValue(props.userFilterSearchValue),
    [props.userFilterSearchValue],
  );
  const searchableUserFilterOptions = useMemo(
    () => buildSearchableUserFilterOptions(userFilterOptionUsers),
    [userFilterOptionUsers],
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
        reportUsers={userFilterOptionUsers}
        selectedUserIds={selectedUserIds}
        selectedUserIdSet={selectedUserIdSet}
        selectedCohorts={selectedCohorts}
        selectedCohortSet={selectedCohortSet}
        selectedPlatforms={selectedPlatforms}
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
        filteredReport={filteredDailyActiveUsersReport}
        generatedAtUtc={dailyActiveUsersReport.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
      />

        <CatalogInstallsSection
        filteredReport={filteredCatalogInstallsReport}
        generatedAtUtc={catalogInstallsReport.generatedAtUtc}
        packageColorScale={packageColorScale}
      />

        <ReviewActivitySection
        filteredReport={filteredReport}
        generatedAtUtc={report.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        filteredUserById={filteredUserById}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
        />
        </> : <AudienceSection
          config={props.config}
          from={report.from}
          to={report.to}
          selectedUserIds={selectedUserIds}
          selectedCohorts={selectedCohorts}
          selectedPlatforms={selectedPlatforms}
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
    onReportRetry: () => void;
    onDateRangeApply: (range: ReviewEventsByDateRange) => void;
    onDateRangeReset: () => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  // Filter selections live above the report areas so that visiting Funnels, which holds no report
  // data, does not discard them. A null draft range follows the applied range of the loaded report.
  const [draftRange, setDraftRange] = useState<ReviewEventsByDateRange | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<ReadonlyArray<string>>([]);
  const [selectedCohorts, setSelectedCohorts] = useState<ReadonlyArray<ReviewEventCohort>>([...reviewEventCohorts]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<ReadonlyArray<ReviewEventPlatform>>([...reviewEventPlatforms]);
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

      {props.activeArea !== "funnels" && props.reportState.status === "ready" ? (
        <AnalyticsReportSections
          activeArea={props.activeArea}
          config={props.config}
          data={props.reportState.data}
          isReportLoading={props.reportState.isReportLoading}
          dateRangeError={props.reportState.dateRangeError}
          draftRange={draftRange ?? {
            from: props.reportState.data.report.from,
            to: props.reportState.data.report.to,
          }}
          selectedUserIds={selectedUserIds}
          selectedCohorts={selectedCohorts}
          selectedPlatforms={selectedPlatforms}
          userFilterSearchValue={userFilterSearchValue}
          onDraftRangeChange={setDraftRange}
          onSelectedUserIdsChange={setSelectedUserIds}
          onSelectedCohortsChange={setSelectedCohorts}
          onSelectedPlatformsChange={setSelectedPlatforms}
          onUserFilterSearchChange={setUserFilterSearchValue}
          onDateRangeApply={props.onDateRangeApply}
          onDateRangeReset={props.onDateRangeReset}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      ) : null}
    </main>
  );
}
