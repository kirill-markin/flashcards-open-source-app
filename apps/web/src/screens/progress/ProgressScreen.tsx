import { useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { useAppData } from "../../appData";
import {
  buildReviewProgressBadgeStateFromSummarySnapshot,
  formatReviewProgressFreezeValue,
  formatReviewProgressBadgeValue,
} from "../../appData/progress/badge/reviewProgressBadge";
import { useProgressInvalidationState } from "../../appData/progress/invalidation/progressInvalidation";
import { canLoadProgressServerBase, useProgressSource } from "../../appData/progress/progressSource";
import { resolveLocaleWeekContext, useI18n } from "../../i18n";
import { progressLeaderboardHash, progressStreakHash } from "../../routes";
import type {
  DailyReviewPoint,
  ProgressLeaderboardWindowKey,
  ProgressReviewScheduleBucketKey,
} from "../../types";
import { ProgressLeaderboardSection } from "./leaderboard/ProgressLeaderboardSection";
import { ProgressReviewScheduleSection } from "./reviewSchedule/ProgressReviewScheduleSection";
import {
  buildReviewScheduleBucketViews,
  buildReviewScheduleDonutSegments,
} from "./reviewSchedule/progressReviewScheduleModel";
import {
  ProgressReviewsChartSection,
  type ProgressReviewsChartNavigationState,
} from "./reviewsChart/ProgressReviewsChartSection";
import {
  buildChartRatingLegendItems,
  buildChartGuideLabels,
  buildChartPages,
  formatChartDayLabel,
  formatChartRangeLabel,
  resolveChartNavigationArrow,
  type ProgressReviewsChartRatingKey,
  type ProgressReviewsChartSelection,
} from "./reviewsChart/progressReviewsChartModel";
import { ProgressStreakSection, type ProgressStreakSummaryView } from "./streak/ProgressStreakSection";
import { buildStreakWeeks } from "./streak/progressStreakModel";

function sortDailyReviews(dailyReviews: ReadonlyArray<DailyReviewPoint>): ReadonlyArray<DailyReviewPoint> {
  return [...dailyReviews].sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
}

export function ProgressScreen(): ReactElement {
  const {
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
  } = useAppData();
  const {
    progressLocalVersion,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
  } = useProgressInvalidationState();
  const location = useLocation();
  const { progressSourceState, refreshProgress } = useProgressSource({
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    sessionVerificationState,
    progressLocalVersion,
    progressScheduleLocalVersion,
    progressServerInvalidationVersion,
    leaderboardAutoRefreshEnabled: true,
    sections: {
      includeSummary: true,
      includeSeries: true,
      includeReviewSchedule: true,
      includeLeaderboard: true,
    },
  });
  const { locale, matchedBrowserLanguageTag, direction, t, formatDate, formatNumber } = useI18n();
  const [selectedPageStartLocalDate, setSelectedPageStartLocalDate] = useState<string | null>(null);
  const [reviewsChartSelection, setReviewsChartSelection] = useState<ProgressReviewsChartSelection>({ kind: "none" });
  const [selectedReviewScheduleBucket, setSelectedReviewScheduleBucket] = useState<ProgressReviewScheduleBucketKey | null>(null);
  const [selectedLeaderboardWindowKey, setSelectedLeaderboardWindowKey] = useState<ProgressLeaderboardWindowKey | null>(null);
  const [isStreakInfoVisible, setIsStreakInfoVisible] = useState<boolean>(false);
  const [isLeaderboardInfoVisible, setIsLeaderboardInfoVisible] = useState<boolean>(false);
  const streakSectionRef = useRef<HTMLElement | null>(null);
  const leaderboardSectionRef = useRef<HTMLElement | null>(null);
  const progressSummary = progressSourceState.summary.renderedSnapshot;
  const progress = progressSourceState.series.renderedSnapshot;
  const reviewSchedule = progressSourceState.reviewSchedule.renderedSnapshot;
  const isLoading = progressSourceState.summary.isLoading
    || progressSourceState.series.isLoading
    || progressSourceState.reviewSchedule.isLoading;
  const errorMessage = progressSourceState.summary.errorMessage !== ""
    ? progressSourceState.summary.errorMessage
    : progressSourceState.series.errorMessage !== ""
      ? progressSourceState.series.errorMessage
      : progressSourceState.reviewSchedule.errorMessage;
  const reviewProgressBadge = buildReviewProgressBadgeStateFromSummarySnapshot(progressSummary);

  useEffect(() => {
    setSelectedPageStartLocalDate(null);
    setReviewsChartSelection({ kind: "none" });
  }, [progressSourceState.series.renderedSnapshot]);

  useEffect(() => {
    setSelectedReviewScheduleBucket(null);
  }, [progressSourceState.reviewSchedule.renderedSnapshot]);

  useEffect(() => {
    if (location.hash === `#${progressLeaderboardHash}`) {
      setSelectedLeaderboardWindowKey(null);
    }
  }, [location.hash, location.key]);

  useEffect(() => {
    if (progress === null) {
      return;
    }

    const targetSection = location.hash === `#${progressStreakHash}`
      ? streakSectionRef.current
      : location.hash === `#${progressLeaderboardHash}`
        ? leaderboardSectionRef.current
        : null;
    if (targetSection === null) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      targetSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [location.hash, progress]);

  const dailyReviews = progress === null ? [] : sortDailyReviews(progress.dailyReviews);
  const today = progress === null ? "" : progress.to;
  const weekContext = resolveLocaleWeekContext(matchedBrowserLanguageTag ?? locale, locale);
  const streakWeeks = progress === null ? [] : buildStreakWeeks(dailyReviews, progress.streakDays, today, formatDate, weekContext);
  const selectedReviewsChartRatingKey = reviewsChartSelection.kind === "rating"
    ? reviewsChartSelection.ratingKey
    : null;
  const chartPages = progress === null
    ? []
    : buildChartPages(dailyReviews, today, formatDate, weekContext, selectedReviewsChartRatingKey);
  const selectedPageIndex = chartPages.findIndex((page) => page.startLocalDate === selectedPageStartLocalDate);
  const visiblePage = chartPages.length === 0
    ? null
    : selectedPageStartLocalDate === null || selectedPageIndex === -1
      ? chartPages[chartPages.length - 1]
      : chartPages[selectedPageIndex];
  const visiblePageHasSelectedDay = reviewsChartSelection.kind === "day"
    && visiblePage !== null
    && visiblePage.days.some((day) => day.date === reviewsChartSelection.date);
  const visibleReviewsChartSelection: ProgressReviewsChartSelection = reviewsChartSelection.kind === "day" && visiblePageHasSelectedDay === false
    ? { kind: "none" }
    : reviewsChartSelection;
  const resolvedSelectedPageIndex = visiblePage === null
    ? 0
    : chartPages.findIndex((page) => page.startLocalDate === visiblePage.startLocalDate);
  const chartGuideLabels = buildChartGuideLabels(visiblePage?.upperBound ?? 1, formatNumber);
  const pageRangeLabel = visiblePage === null
    ? ""
    : visibleReviewsChartSelection.kind === "day"
      ? formatChartDayLabel(visibleReviewsChartSelection.date, locale)
    : formatChartRangeLabel(visiblePage.startDate, visiblePage.endDate, locale);
  const chartRatingLegendItems = buildChartRatingLegendItems(
    visiblePage,
    visibleReviewsChartSelection,
    t,
    formatNumber,
  );
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressFreezeStatus = t("reviewScreen.progressBadge.freezeBank", {
    available: formatNumber(reviewProgressBadge.streakFreeze.availableCredits),
    capacity: formatNumber(reviewProgressBadge.streakFreeze.capacity),
  });
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.ariaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
    freezeBank: reviewProgressFreezeStatus,
  });
  const progressStreakInfoText = progressSummary === null
    ? null
    : t("progressScreen.streakInfo", {
      available: formatNumber(progressSummary.summary.streakFreeze.availableCredits),
      capacity: formatNumber(progressSummary.summary.streakFreeze.capacity),
      progress: formatNumber(progressSummary.summary.streakFreeze.nextCreditProgressUnits),
      required: formatNumber(progressSummary.summary.streakFreeze.nextCreditRequiredUnits),
    });
  const progressStreakSummary: ProgressStreakSummaryView | null = progressSummary === null
    ? null
    : {
      label: t("reviewScreen.progressBadge.title"),
      status: reviewProgressBadgeTodayStatus,
      hasReviewedToday: reviewProgressBadge.hasReviewedToday,
      ariaLabel: reviewProgressBadgeAriaLabel,
      formattedStreakValue: formatReviewProgressBadgeValue(reviewProgressBadge.streakDays),
      formattedFreezeValue: formatReviewProgressFreezeValue(reviewProgressBadge.streakFreeze, formatNumber),
    };
  const previousWeekArrow = resolveChartNavigationArrow(direction, "previous");
  const nextWeekArrow = resolveChartNavigationArrow(direction, "next");
  const chartNavigation: ProgressReviewsChartNavigationState | null = chartPages.length <= 1
    ? null
    : {
      previousPageStartLocalDate: chartPages[resolvedSelectedPageIndex - 1]?.startLocalDate ?? null,
      nextPageStartLocalDate: chartPages[resolvedSelectedPageIndex + 1]?.startLocalDate ?? null,
      previousWeekLabel: t("progressScreen.previousWeek"),
      nextWeekLabel: t("progressScreen.nextWeek"),
      previousWeekArrow,
      nextWeekArrow,
    };
  // The bucket views and donut segments are derived from the snapshot on every render.
  // The work is cheap (8 buckets, short string concats and arc math); a useMemo here
  // would be a no-op because t/formatNumber from useI18n are rebuilt per render.
  const reviewScheduleBucketViews = reviewSchedule === null
    ? []
    : buildReviewScheduleBucketViews(reviewSchedule, t, formatNumber);
  const reviewScheduleDonutSegments = buildReviewScheduleDonutSegments(reviewScheduleBucketViews);
  const canRenderLeaderboardServerBase = canLoadProgressServerBase(sessionVerificationState, cloudSettings);
  const handleSelectChartPageStartLocalDate = (pageStartLocalDate: string | null): void => {
    setSelectedPageStartLocalDate(pageStartLocalDate);
    setReviewsChartSelection({ kind: "none" });
  };
  const handleSelectReviewsChartDay = (date: string): void => {
    setReviewsChartSelection((previousSelection) => (
      previousSelection.kind === "day" && previousSelection.date === date
        ? { kind: "none" }
        : { kind: "day", date }
    ));
  };
  const handleSelectReviewsChartRating = (ratingKey: ProgressReviewsChartRatingKey): void => {
    setReviewsChartSelection((previousSelection) => (
      previousSelection.kind === "rating" && previousSelection.ratingKey === ratingKey
        ? { kind: "none" }
        : { kind: "rating", ratingKey }
    ));
  };
  const handleClearReviewsChartSelection = (): void => {
    setReviewsChartSelection({ kind: "none" });
  };
  const handleSelectReviewScheduleBucket = (bucketKey: ProgressReviewScheduleBucketKey): void => {
    setSelectedReviewScheduleBucket((previous) => (previous === bucketKey ? null : bucketKey));
  };
  const handleClearReviewScheduleSelection = (): void => {
    setSelectedReviewScheduleBucket(null);
  };

  return (
    <main className="container">
      <section className="panel progress-panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{t("progressScreen.title")}</h1>
            <p className="subtitle">{t("progressScreen.subtitle")}</p>
          </div>

          <button className="ghost-btn" type="button" onClick={() => void refreshProgress()}>
            {t("common.refresh")}
          </button>
        </div>

        {isLoading && progress === null ? <p className="subtitle">{t("loading.progress")}</p> : null}

        {errorMessage !== "" ? (
          <>
            <p className="error-banner">{errorMessage}</p>
          </>
        ) : null}

        {progress !== null ? (
          <div className="progress-layout">
            <ProgressStreakSection
              title={t("progressScreen.streakTitle")}
              sectionId={progressStreakHash}
              sectionRef={streakSectionRef}
              summary={progressStreakSummary}
              infoText={progressStreakInfoText}
              infoToggleLabel={t("progressScreen.streakInfoToggleLabel")}
              isInfoVisible={isStreakInfoVisible}
              onToggleInfo={() => setIsStreakInfoVisible((previous) => previous === false)}
              streakWeeks={streakWeeks}
            />

            <ProgressLeaderboardSection
              sectionId={progressLeaderboardHash}
              sectionRef={leaderboardSectionRef}
              sourceState={progressSourceState.leaderboard}
              canRenderServerBase={canRenderLeaderboardServerBase}
              selectedWindowKey={selectedLeaderboardWindowKey}
              onSelectWindowKey={setSelectedLeaderboardWindowKey}
              isInfoVisible={isLeaderboardInfoVisible}
              onToggleInfo={() => setIsLeaderboardInfoVisible((previous) => previous === false)}
            />

            <ProgressReviewsChartSection
              title={t("progressScreen.reviewsTitle")}
              pageRangeLabel={pageRangeLabel}
              visiblePage={visiblePage}
              chartGuideLabels={chartGuideLabels}
              legendLabel={t("progressScreen.reviewsBreakdown.legendLabel")}
              ratingLegendItems={chartRatingLegendItems}
              selection={visibleReviewsChartSelection}
              navigation={chartNavigation}
              onSelectPageStartLocalDate={handleSelectChartPageStartLocalDate}
              onSelectDay={handleSelectReviewsChartDay}
              onSelectRating={handleSelectReviewsChartRating}
              onClearSelection={handleClearReviewsChartSelection}
            />

            {reviewSchedule !== null ? (
              <ProgressReviewScheduleSection
                title={t("progressScreen.reviewSchedule.title")}
                totalCardsLabel={t("progressScreen.reviewSchedule.totalCards", {
                  count: formatNumber(reviewSchedule.totalCards),
                })}
                legendLabel={t("progressScreen.reviewSchedule.legendLabel")}
                selectedBucket={selectedReviewScheduleBucket}
                bucketViews={reviewScheduleBucketViews}
                donutSegments={reviewScheduleDonutSegments}
                onSelectBucket={handleSelectReviewScheduleBucket}
                onClearSelection={handleClearReviewScheduleSelection}
              />
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
