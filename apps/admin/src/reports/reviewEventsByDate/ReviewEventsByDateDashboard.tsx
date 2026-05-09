import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import type { ReviewEventsByDateReport } from "../../adminApi";
import { buildReviewEventsByDateChartModel } from "./chartModel";
import { ReviewEventsByDateCharts } from "./ReviewEventsByDateCharts";
import { ReviewEventsByDateFilters } from "./ReviewEventsByDateFilters";
import {
  buildReviewEventsByDateSummaryCards,
  ReviewEventsByDateSummary,
} from "./ReviewEventsByDateSummary";
import { formatDateRangeLabel } from "./formatting";
import {
  buildActiveUserFilters,
  buildSearchableUserFilterOptions,
  doesUserMatchSearch,
  getNormalizedSearchValue,
  visibleUserFilterOptionLimit,
} from "./userFilters";
import {
  filterReviewEventsByDateReportByUsers,
  type ReviewEventsByDateRange,
} from "./query";

export function ReviewEventsByDateDashboard(
  props: Readonly<{
    report: ReviewEventsByDateReport;
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
    setSelectedUserIds((currentUserIds) => {
      if (isChecked) {
        if (currentUserIds.includes(userId)) {
          return currentUserIds;
        }

        return [...currentUserIds, userId];
      }

      return currentUserIds.filter((currentUserId) => currentUserId !== userId);
    });
  }

  function handleUserFilterRemove(userId: string): void {
    setSelectedUserIds((currentUserIds) => currentUserIds.filter((currentUserId) => currentUserId !== userId));
  }

  function handleUserFilterClear(): void {
    setSelectedUserIds([]);
  }

  const handleChartUserFilterApply = useCallback((userId: string): void => {
    setSelectedUserIds([userId]);
  }, []);

  const filteredReport = useMemo(
    () => filterReviewEventsByDateReportByUsers(props.report, selectedUserIds),
    [props.report, selectedUserIds],
  );
  const selectedUserIdSet = useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds],
  );
  const userById = useMemo(
    () => new Map(props.report.users.map((user) => [user.userId, user])),
    [props.report.users],
  );
  const activeUserFilters = useMemo(
    () => buildActiveUserFilters(selectedUserIds, userById),
    [selectedUserIds, userById],
  );
  const normalizedUserFilterSearchValue = useMemo(
    () => getNormalizedSearchValue(userFilterSearchValue),
    [userFilterSearchValue],
  );
  const searchableUserFilterOptions = useMemo(
    () => buildSearchableUserFilterOptions(props.report.users),
    [props.report.users],
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
  const chartModel = useMemo(
    () => buildReviewEventsByDateChartModel(filteredReport, props.report.users),
    [filteredReport, props.report.users],
  );
  const summaryCards = useMemo(
    () => buildReviewEventsByDateSummaryCards(
      filteredReport,
      chartModel.peakDailyVolume,
      chartModel.peakDailyUniqueUsers,
    ),
    [chartModel.peakDailyUniqueUsers, chartModel.peakDailyVolume, filteredReport],
  );

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Admin Analytics</p>
          <h1>Review Events By Date</h1>
        </div>
        <p className="subhead">
          Daily unique reviewers and stacked review-event volume by calendar date. The first two charts show overall user activity and per-user event volume. The two platform charts below compare active users and review events across <strong>web</strong>, <strong>android</strong>, and <strong>ios</strong>. Dates are grouped in <strong>UTC</strong>.
        </p>
        <div className="hero-meta">
          <span className="hero-badge">Signed in as {props.adminEmail}</span>
          <span className="hero-badge">Range {formatDateRangeLabel(props.report.from)} to {formatDateRangeLabel(props.report.to)}</span>
          <span className="hero-badge">All dates and times in UTC</span>
        </div>
      </section>

      <ReviewEventsByDateFilters
        defaultRange={props.defaultRange}
        draftRange={draftRange}
        isReportLoading={props.isReportLoading}
        dateRangeError={props.dateRangeError}
        reportUsers={props.report.users}
        selectedUserIds={selectedUserIds}
        selectedUserIdSet={selectedUserIdSet}
        userFilterSearchValue={userFilterSearchValue}
        visibleUserFilterOptions={visibleUserFilterOptions}
        matchingUserFilterOptionCount={matchingUserFilterOptions.length}
        hiddenUserFilterOptionCount={hiddenUserFilterOptionCount}
        activeUserFilters={activeUserFilters}
        userColorScale={chartModel.userColorScale}
        onFromDateChange={handleFromDateChange}
        onToDateChange={handleToDateChange}
        onDateRangeSubmit={handleDateRangeSubmit}
        onDateRangeReset={handleDateRangeReset}
        onUserFilterSearchChange={setUserFilterSearchValue}
        onUserFilterChange={handleUserFilterChange}
        onUserFilterRemove={handleUserFilterRemove}
        onUserFilterClear={handleUserFilterClear}
      />

      <ReviewEventsByDateSummary cards={summaryCards} />

      <ReviewEventsByDateCharts
        chartModel={chartModel}
        generatedAtUtc={props.report.generatedAtUtc}
        isReportLoading={props.isReportLoading}
        userById={userById}
        onUserFilterApply={handleChartUserFilterApply}
      />
    </main>
  );
}
