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

export function AdminDashboard(
  props: Readonly<{
    activeArea: AnalyticsArea;
    onNavigate: (path: string) => void;
    config: AdminAppConfig;
    report: ReviewEventsByDateReport;
    dailyActiveUsersReport: DailyActiveUsersReport;
    catalogInstallsReport: CatalogInstallsReport;
    adminEmail: string;
    availableRange: ReviewEventsByDateRange;
    defaultRange: ReviewEventsByDateRange;
    isReportLoading: boolean;
    dateRangeError: string;
    onDateRangeApply: (range: ReviewEventsByDateRange) => void;
    onDateRangeReset: () => void;
    onTerminalAdminError: (error: unknown, config: AdminAppConfig) => boolean;
  }>,
): JSX.Element {
  const [draftRange, setDraftRange] = useState<ReviewEventsByDateRange>({
    from: props.report.from,
    to: props.report.to,
  });
  const [selectedUserIds, setSelectedUserIds] = useState<ReadonlyArray<string>>([]);
  const [selectedCohorts, setSelectedCohorts] = useState<ReadonlyArray<ReviewEventCohort>>([...reviewEventCohorts]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<ReadonlyArray<ReviewEventPlatform>>([...reviewEventPlatforms]);
  const [userFilterSearchValue, setUserFilterSearchValue] = useState<string>("");

  useEffect(() => {
    setDraftRange({
      from: props.report.from,
      to: props.report.to,
    });
  }, [props.report.from, props.report.to]);

  function handleFromDateChange(from: string): void {
    setDraftRange((currentRange) => ({
      ...currentRange,
      from,
    }));
  }

  function handleToDateChange(to: string): void {
    setDraftRange((currentRange) => ({
      ...currentRange,
      to,
    }));
  }

  function handleDateRangeSubmit(): void {
    props.onDateRangeApply(draftRange);
  }

  function handleDateRangeReset(): void {
    setDraftRange(props.defaultRange);
    props.onDateRangeReset();
  }

  function handleLastThreeDays(): void {
    const fromDate = new Date(`${props.availableRange.to}T00:00:00.000Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - 2);
    const requestedFrom = fromDate.toISOString().slice(0, 10);
    const range = {
      from: requestedFrom < props.availableRange.from ? props.availableRange.from : requestedFrom,
      to: props.availableRange.to,
    };
    setDraftRange(range);
    props.onDateRangeApply(range);
  }

  function handleUserFilterChange(userId: string, isChecked: boolean): void {
    setSelectedUserIds((currentUserIds) => getUpdatedUserFilterSelection(currentUserIds, userId, isChecked));
  }

  function handleUserFilterRemove(userId: string): void {
    setSelectedUserIds((currentUserIds) => currentUserIds.filter((currentUserId) => currentUserId !== userId));
  }

  function handleUserFilterClear(): void {
    setSelectedUserIds([]);
  }

  function handleCohortFilterChange(cohort: ReviewEventCohort, isChecked: boolean): void {
    setSelectedCohorts((currentCohorts) => getUpdatedCohortFilterSelection(currentCohorts, cohort, isChecked));
  }

  function handlePlatformFilterChange(platform: ReviewEventPlatform, isChecked: boolean): void {
    setSelectedPlatforms((currentPlatforms) => getUpdatedPlatformFilterSelection(currentPlatforms, platform, isChecked));
  }

  function handleAllFiltersReset(): void {
    setDraftRange(props.defaultRange);
    setSelectedUserIds([]);
    setSelectedCohorts([...reviewEventCohorts]);
    setSelectedPlatforms([...reviewEventPlatforms]);
    setUserFilterSearchValue("");
    props.onDateRangeReset();
  }

  const handleChartUserFilterApply = useCallback((userId: string): void => {
    setSelectedUserIds([userId]);
  }, []);

  const filteredReport = useMemo(
    () => filterReviewEventsByDateReport(props.report, {
      selectedUserIds,
      selectedCohorts,
      selectedPlatforms,
    }),
    [props.report, selectedCohorts, selectedPlatforms, selectedUserIds],
  );
  const filteredDailyActiveUsersReport = useMemo(
    () => filterDailyActiveUsersReport(props.dailyActiveUsersReport, {
      selectedUserIds,
      selectedCohorts,
      selectedPlatforms,
    }),
    [props.dailyActiveUsersReport, selectedCohorts, selectedPlatforms, selectedUserIds],
  );
  // The cohort split comes from the unfiltered daily active users report, so narrowing a filter
  // cannot change which day an installer counts as new on.
  const filteredCatalogInstallsReport = useMemo(
    () => filterCatalogInstallsReport(props.catalogInstallsReport, {
      selectedUserIds,
      selectedCohorts,
      selectedPlatforms,
      firstActiveDateByUserId: props.dailyActiveUsersReport.firstActiveDateByUserId,
    }),
    [
      props.catalogInstallsReport,
      props.dailyActiveUsersReport.firstActiveDateByUserId,
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
      props.report.users,
      props.report.communityOnlyUsers,
      props.dailyActiveUsersReport.users,
      props.catalogInstallsReport.users,
    ),
    [
      props.catalogInstallsReport.users,
      props.dailyActiveUsersReport.users,
      props.report.communityOnlyUsers,
      props.report.users,
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
      ...props.report.users,
      ...props.report.communityOnlyUsers,
      ...props.dailyActiveUsersReport.users,
      ...props.catalogInstallsReport.users,
    ])),
    [
      props.catalogInstallsReport.users,
      props.dailyActiveUsersReport.users,
      props.report.communityOnlyUsers,
      props.report.users,
    ],
  );
  // Built from the loaded report rather than the filtered one, for the same reason the user colour
  // domain is: a deck must not change colour because a filter removed another deck.
  const packageColorScale = useMemo(
    () => getPackageColorScale(
      props.catalogInstallsReport.packages.map((catalogPackage) => catalogPackage.packageSlug),
    ),
    [props.catalogInstallsReport.packages],
  );
  const activeUserFilters = useMemo(
    () => buildActiveUserFilters(selectedUserIds, reportUserById),
    [selectedUserIds, reportUserById],
  );
  const normalizedUserFilterSearchValue = useMemo(
    () => getNormalizedSearchValue(userFilterSearchValue),
    [userFilterSearchValue],
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
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin Analytics</p>
          <h1>Product Analytics</h1>
        </div>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">General range {formatDateRangeLabel(props.report.from)} to {formatDateRangeLabel(props.report.to)}</span>
          <span className="hero-badge">All dates and times in UTC</span>
        </div>
      </section>

      <nav className="analytics-navigation" aria-label="Analytics sections">
        <AdminLink className={props.activeArea === "general" ? "active" : ""} path={getAnalyticsAreaPath("general")} ariaCurrent={props.activeArea === "general" ? "page" : undefined} onNavigate={props.onNavigate}>{analyticsAreaLabels.general}</AdminLink>
        <AdminLink className={props.activeArea === "funnels" ? "active" : ""} path={getAnalyticsAreaPath("funnels")} ariaCurrent={props.activeArea === "funnels" ? "page" : undefined} onNavigate={props.onNavigate}>{analyticsAreaLabels.funnels}</AdminLink>
        <AdminLink testId="analytics-audience-tab" className={props.activeArea === "audience" ? "active" : ""} path={getAnalyticsAreaPath("audience")} ariaCurrent={props.activeArea === "audience" ? "page" : undefined} onNavigate={props.onNavigate}>{analyticsAreaLabels.audience}</AdminLink>
      </nav>

      {props.activeArea !== "funnels" ? <>
        <ReviewEventsByDateFilters
        availableRange={props.availableRange}
        defaultRange={props.defaultRange}
        appliedRange={{
          from: props.report.from,
          to: props.report.to,
        }}
        draftRange={draftRange}
        isReportLoading={props.isReportLoading}
        dateRangeError={props.dateRangeError}
        reportUsers={userFilterOptionUsers}
        selectedUserIds={selectedUserIds}
        selectedUserIdSet={selectedUserIdSet}
        selectedCohorts={selectedCohorts}
        selectedCohortSet={selectedCohortSet}
        selectedPlatforms={selectedPlatforms}
        selectedPlatformSet={selectedPlatformSet}
        userFilterSearchValue={userFilterSearchValue}
        visibleUserFilterOptions={visibleUserFilterOptions}
        matchingUserFilterOptionCount={matchingUserFilterOptions.length}
        hiddenUserFilterOptionCount={hiddenUserFilterOptionCount}
        activeUserFilters={activeUserFilters}
        userColorScale={userColorScale}
        onFromDateChange={handleFromDateChange}
        onToDateChange={handleToDateChange}
        onDateRangeSubmit={handleDateRangeSubmit}
        onDateRangeReset={handleDateRangeReset}
        onUserFilterSearchChange={setUserFilterSearchValue}
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
        generatedAtUtc={props.dailyActiveUsersReport.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
      />

        <CatalogInstallsSection
        filteredReport={filteredCatalogInstallsReport}
        generatedAtUtc={props.catalogInstallsReport.generatedAtUtc}
        packageColorScale={packageColorScale}
      />

        <ReviewActivitySection
        filteredReport={filteredReport}
        generatedAtUtc={props.report.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        filteredUserById={filteredUserById}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
        />
        </> : <AudienceSection
          config={props.config}
          from={props.report.from}
          to={props.report.to}
          selectedUserIds={selectedUserIds}
          selectedCohorts={selectedCohorts}
          selectedPlatforms={selectedPlatforms}
          isRangeLoading={props.isReportLoading}
          onLastThreeDays={handleLastThreeDays}
          onTerminalAdminError={props.onTerminalAdminError}
        />}
      </> : (
        <CatalogInstallFunnelSection
          config={props.config}
          onTerminalAdminError={props.onTerminalAdminError}
        />
      )}
    </main>
  );
}
