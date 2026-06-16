import type { ComponentProps, ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  formatReviewProgressBadgeValue,
  formatReviewProgressFreezeValue,
} from "../../../appData/progress/badge/reviewProgressBadge";
import { useI18n } from "../../../i18n";
import { progressLeaderboardRoute, progressStreakRoute } from "../../../routes";
import type { ReviewProgressBadgeState } from "../../../types";
import { ProgressLeaderboardShortcutIcon, ReviewProgressBadgeIcon, ReviewQueueShortcutIcon, StreakFreezeIcon } from "../../shared/ReviewProgressBadgeIcon";
import { ReviewFilterMenu } from "../filters/ReviewFilterMenu";

type ReviewLeaderboardBadgeState = Readonly<{
  isInteractive: boolean;
  rank: number | null;
}>;

export type ReviewScreenHeaderProps = Readonly<{
  filterMenuProps: ComponentProps<typeof ReviewFilterMenu>;
  hasLoadedReviewData: boolean;
  isReviewQueuePanelOpen: boolean;
  onRetry: () => void;
  onReviewQueueShortcutClick: () => void;
  reviewQueueTotalCount: number;
  reviewLoadErrorMessage: string;
  reviewLeaderboardBadge: ReviewLeaderboardBadgeState;
  reviewProgressBadge: ReviewProgressBadgeState;
  reviewSpeechMessage: string;
}>;

export function ReviewScreenHeader(props: ReviewScreenHeaderProps): ReactElement {
  const {
    filterMenuProps,
    hasLoadedReviewData,
    isReviewQueuePanelOpen,
    onRetry,
    onReviewQueueShortcutClick,
    reviewQueueTotalCount,
    reviewLoadErrorMessage,
    reviewLeaderboardBadge,
    reviewProgressBadge,
    reviewSpeechMessage,
  } = props;
  const { t, formatCount, formatNumber } = useI18n();
  const reviewQueueCountLabel = formatCount(reviewQueueTotalCount, {
    one: t("common.countLabels.card.one"),
    other: t("common.countLabels.card.other"),
  });
  const reviewQueueAriaLabel = `${t("reviewScreen.queue.title")}: ${reviewQueueCountLabel}`;
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressFreezeValue = formatReviewProgressFreezeValue(reviewProgressBadge.streakFreeze, formatNumber);
  const reviewProgressFreezeStatus = t("reviewScreen.progressBadge.freezeBank", {
    available: formatNumber(reviewProgressBadge.streakFreeze.availableCredits),
    capacity: formatNumber(reviewProgressBadge.streakFreeze.capacity),
  });
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.ariaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
    freezeBank: reviewProgressFreezeStatus,
  });
  const leaderboardShortcutRankLabel = reviewLeaderboardBadge.rank === null
    ? null
    : t("progressScreen.leaderboard.rankLabel", { rank: formatNumber(reviewLeaderboardBadge.rank) });
  const leaderboardShortcutAriaLabel = leaderboardShortcutRankLabel === null
    ? t("reviewScreen.leaderboardShortcut.ariaLabel")
    : `${t("reviewScreen.leaderboardShortcut.ariaLabel")}. ${leaderboardShortcutRankLabel}`;
  const isReviewQueueShortcutDisabled = reviewQueueTotalCount === 0;

  return (
    <div className="screen-head review-screen-head">
      <div>
        <h1 className="title">{t("reviewScreen.title")}</h1>
        <p className="subtitle">{t("reviewScreen.subtitle")}</p>
        {reviewLoadErrorMessage !== "" ? <p className="error-banner">{reviewLoadErrorMessage}</p> : null}
        {reviewSpeechMessage !== "" ? <p className="review-transient-message" role="status">{reviewSpeechMessage}</p> : null}
        {reviewLoadErrorMessage !== "" && hasLoadedReviewData === false ? (
          <button className="primary-btn review-loading-retry-btn" type="button" onClick={onRetry}>
            {t("reviewScreen.actions.retry")}
          </button>
        ) : null}
      </div>
      <div className="screen-actions review-screen-head-actions">
        <ReviewFilterMenu {...filterMenuProps} />
        <div className="review-filter-summary-wrap">
          <span className="review-filter-label">{t("common.status")}</span>
          <div className="review-progress-shortcuts">
            <button
              className="badge review-progress-badge review-screen-head-badge review-queue-shortcut"
              type="button"
              aria-controls="review-queue-panel"
              aria-expanded={isReviewQueueShortcutDisabled ? undefined : isReviewQueuePanelOpen}
              aria-label={reviewQueueAriaLabel}
              title={reviewQueueAriaLabel}
              data-testid="review-queue-badge"
              disabled={isReviewQueueShortcutDisabled}
              onClick={onReviewQueueShortcutClick}
            >
              <ReviewQueueShortcutIcon />
            </button>
            <Link
              className={`badge review-progress-badge review-screen-head-badge review-leaderboard-shortcut${reviewLeaderboardBadge.rank === null ? "" : " review-leaderboard-shortcut-ranked"}`}
              to={progressLeaderboardRoute}
              aria-label={leaderboardShortcutAriaLabel}
              title={leaderboardShortcutAriaLabel}
              data-testid="review-leaderboard-shortcut"
              aria-disabled={reviewLeaderboardBadge.isInteractive ? undefined : "true"}
            >
              <ProgressLeaderboardShortcutIcon />
              {reviewLeaderboardBadge.rank === null ? null : (
                <span className="review-progress-badge-value">{formatNumber(reviewLeaderboardBadge.rank)}</span>
              )}
            </Link>
            <Link
              className={`badge review-progress-badge review-screen-head-badge${reviewProgressBadge.hasReviewedToday ? " review-progress-badge-active" : ""}`}
              to={progressStreakRoute}
              aria-label={reviewProgressBadgeAriaLabel}
              title={reviewProgressBadgeAriaLabel}
              data-testid="review-progress-badge"
              aria-disabled={reviewProgressBadge.isInteractive ? undefined : "true"}
            >
              <ReviewProgressBadgeIcon />
              <span className="review-progress-badge-value">{formatReviewProgressBadgeValue(reviewProgressBadge.streakDays)}</span>
              <span className="review-progress-freeze-indicator" aria-hidden="true">
                <StreakFreezeIcon />
                <span className="review-progress-freeze-value">{reviewProgressFreezeValue}</span>
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
