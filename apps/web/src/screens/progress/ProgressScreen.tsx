import { useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { useAppData } from "../../appData";
import {
  buildReviewProgressBadgeStateFromSummarySnapshot,
  formatReviewProgressBadgeValue,
} from "../../appData/progress/badge/reviewProgressBadge";
import { useProgressInvalidationState } from "../../appData/progress/invalidation/progressInvalidation";
import { canLoadProgressServerBase, useProgressSource } from "../../appData/progress/progressSource";
import { resolveLocaleWeekContext, useI18n } from "../../i18n";
import { progressLeaderboardHash } from "../../routes";
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
  buildChartGuideLabels,
  buildChartPages,
  formatChartRangeLabel,
  resolveChartNavigationArrow,
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
    sections: {
      includeSummary: true,
      includeSeries: true,
      includeReviewSchedule: true,
      includeLeaderboard: true,
    },
  });
  const { locale, matchedBrowserLanguageTag, direction, t, formatDate, formatNumber } = useI18n();
  const [selectedPageStartLocalDate, setSelectedPageStartLocalDate] = useState<string | null>(null);
  const [selectedReviewScheduleBucket, setSelectedReviewScheduleBucket] = useState<ProgressReviewScheduleBucketKey | null>(null);
  const [selectedLeaderboardWindowKey, setSelectedLeaderboardWindowKey] = useState<ProgressLeaderboardWindowKey | null>(null);
  const [isLeaderboardInfoVisible, setIsLeaderboardInfoVisible] = useState<boolean>(false);
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
  }, [progressSourceState.series.renderedSnapshot]);

  useEffect(() => {
    setSelectedReviewScheduleBucket(null);
  }, [progressSourceState.reviewSchedule.renderedSnapshot]);

  useEffect(() => {
    if (location.hash !== `#${progressLeaderboardHash}` || progress === null) {
      return;
    }

    const leaderboardSection = leaderboardSectionRef.current;
    if (leaderboardSection === null) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      leaderboardSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [location.hash, progress, progressSourceState.leaderboard.renderedSnapshot]);

  const dailyReviews = progress === null ? [] : sortDailyReviews(progress.dailyReviews);
  const today = progress === null ? "" : progress.to;
  const weekContext = resolveLocaleWeekContext(matchedBrowserLanguageTag ?? locale, locale);
  const streakWeeks = progress === null ? [] : buildStreakWeeks(dailyReviews, today, formatDate, weekContext);
  const chartPages = progress === null ? [] : buildChartPages(dailyReviews, today, formatDate, weekContext);
  const selectedPageIndex = chartPages.findIndex((page) => page.startLocalDate === selectedPageStartLocalDate);
  const visiblePage = chartPages.length === 0
    ? null
    : selectedPageStartLocalDate === null || selectedPageIndex === -1
      ? chartPages[chartPages.length - 1]
      : chartPages[selectedPageIndex];
  const resolvedSelectedPageIndex = visiblePage === null
    ? 0
    : chartPages.findIndex((page) => page.startLocalDate === visiblePage.startLocalDate);
  const chartGuideLabels = buildChartGuideLabels(visiblePage?.upperBound ?? 1, formatNumber);
  const pageRangeLabel = visiblePage === null
    ? ""
    : formatChartRangeLabel(visiblePage.startDate, visiblePage.endDate, locale);
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.ariaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
  });
  const progressStreakSummary: ProgressStreakSummaryView | null = progressSummary === null
    ? null
    : {
      label: t("reviewScreen.progressBadge.title"),
      status: reviewProgressBadgeTodayStatus,
      hasReviewedToday: reviewProgressBadge.hasReviewedToday,
      ariaLabel: reviewProgressBadgeAriaLabel,
      formattedStreakValue: formatReviewProgressBadgeValue(reviewProgressBadge.streakDays),
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
              summary={progressStreakSummary}
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
              navigation={chartNavigation}
              onSelectPageStartLocalDate={setSelectedPageStartLocalDate}
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
