import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type DailyActiveUsersReport,
  type DailyActiveUsersUser,
  type ReviewEventCohort,
  type ReviewEventPlatform,
  type ReviewEventsByDateReport,
  type ReviewEventsByDateUser,
} from "../adminApi";
import { formatDateRangeLabel } from "../charts/formatting";
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
import { getStableUserColorDomain, getUserColorScale } from "./userColors";

/**
 * The people the shared user filter and the shared colour scale have to cover: everyone with review
 * events, everyone with community activity, and everyone who opened the app. A person present in
 * more than one section appears once. An active user with no review events in range carries a zero
 * review total, which is what the filter list already shows for a community-only user.
 */
function buildUserFilterOptionUsers(
  reviewUsers: ReadonlyArray<ReviewEventsByDateUser>,
  communityOnlyUsers: ReadonlyArray<ReviewEventsByDateUser>,
  activeUsers: ReadonlyArray<DailyActiveUsersUser>,
): ReadonlyArray<ReviewEventsByDateUser> {
  const usersByUserId = new Map<string, ReviewEventsByDateUser>(
    [...reviewUsers, ...communityOnlyUsers].map((user) => [user.userId, user]),
  );

  for (const activeUser of activeUsers) {
    if (usersByUserId.has(activeUser.userId)) {
      continue;
    }

    usersByUserId.set(activeUser.userId, {
      userId: activeUser.userId,
      email: activeUser.email,
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
    report: ReviewEventsByDateReport;
    dailyActiveUsersReport: DailyActiveUsersReport;
    adminEmail: string;
    defaultRange: ReviewEventsByDateRange;
    isReportLoading: boolean;
    dateRangeError: string;
    onDateRangeApply: (range: ReviewEventsByDateRange) => void;
    onDateRangeReset: () => void;
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
    ),
    [props.dailyActiveUsersReport.users, props.report.communityOnlyUsers, props.report.users],
  );
  // Every selectable person, so an active-user chip selected from the daily active users chart still
  // resolves to a label even when that person has no review events.
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
    ])),
    [props.dailyActiveUsersReport.users, props.report.communityOnlyUsers, props.report.users],
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
          <span className="hero-badge">Range {formatDateRangeLabel(props.report.from)} to {formatDateRangeLabel(props.report.to)}</span>
          <span className="hero-badge">All dates and times in UTC</span>
        </div>
      </section>

      <ReviewEventsByDateFilters
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

      <DailyActiveUsersSection
        filteredReport={filteredDailyActiveUsersReport}
        generatedAtUtc={props.dailyActiveUsersReport.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
      />

      <ReviewActivitySection
        filteredReport={filteredReport}
        generatedAtUtc={props.report.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        filteredUserById={filteredUserById}
        userColorScale={userColorScale}
        onUserFilterApply={handleChartUserFilterApply}
      />
    </main>
  );
}
