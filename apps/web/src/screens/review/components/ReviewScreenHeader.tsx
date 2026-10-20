import type { ComponentProps, ReactElement } from "react";
import { Link } from "react-router";
import { formatReviewProgressBadgeValue } from "../../../appData/progress/badge/reviewProgressBadge";
import { useI18n } from "../../../i18n";
import { progressLeaderboardRoute, progressStreakRoute } from "../../../routes";
import { useWorkspacePath } from "../../../useWorkspacePath";
import type { ReviewProgressBadgeState } from "../../../types";
import { ProgressLeaderboardShortcutIcon, ReviewProgressBadgeIcon, ReviewQueueShortcutIcon } from "../../shared/ReviewProgressBadgeIcon";
import { ReviewFilterMenu } from "../filters/ReviewFilterMenu";
import { ReviewMoreActionsMenu } from "./ReviewMoreActionsMenu";

type ReviewLeaderboardBadgeState = Readonly<{
  isInteractive: boolean;
  rank: number | null;
}>;

export type ReviewScreenHeaderProps = Readonly<{
  filterMenuProps: ComponentProps<typeof ReviewFilterMenu>;
  hasLoadedReviewData: boolean;
  isReviewMoreActionsMenuOpen: boolean;
  isReviewQueuePanelOpen: boolean;
  onRetry: () => void;
  onReviewFilterMenuOpenFromMoreActions: () => void;
  onReviewMoreActionsMenuOpenChange: (isOpen: boolean) => void;
  onReviewQueueShortcutClick: () => void;
  reviewQueueTotalCount: number;
  reviewLoadErrorMessage: string;
  reviewLeaderboardBadge: ReviewLeaderboardBadgeState;
  reviewMoreActionsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  reviewProgressBadge: ReviewProgressBadgeState;
  reviewSpeechMessage: string;
}>;

export function ReviewScreenHeader(props: ReviewScreenHeaderProps): ReactElement {
  const {
    filterMenuProps,
    hasLoadedReviewData,
    isReviewMoreActionsMenuOpen,
    isReviewQueuePanelOpen,
    onRetry,
    onReviewFilterMenuOpenFromMoreActions,
    onReviewMoreActionsMenuOpenChange,
    onReviewQueueShortcutClick,
    reviewQueueTotalCount,
    reviewLoadErrorMessage,
    reviewLeaderboardBadge,
    reviewMoreActionsTriggerRef,
    reviewProgressBadge,
    reviewSpeechMessage,
  } = props;
  const { messages, t, formatCount, formatNumber } = useI18n();
  const workspacePath = useWorkspacePath();
  const reviewQueueCountLabel = formatCount(reviewQueueTotalCount, messages.common.countLabels.card);
  const reviewQueueAriaLabel = `${t("reviewScreen.queue.title")}: ${reviewQueueCountLabel}`;
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.reviewAriaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
  });
  const leaderboardShortcutRankLabel = reviewLeaderboardBadge.rank === null
    ? null
    : t("progressScreen.leaderboard.rankLabel", { rank: formatNumber(reviewLeaderboardBadge.rank) });
  const leaderboardShortcutAriaLabel = leaderboardShortcutRankLabel === null
    ? t("reviewScreen.leaderboardShortcut.ariaLabel")
    : `${t("reviewScreen.leaderboardShortcut.ariaLabel")}. ${leaderboardShortcutRankLabel}`;
  const isReviewQueueShortcutDisabled = reviewQueueTotalCount === 0 && isReviewQueuePanelOpen === false;

  return (
    <div className="review-screen-header">
      <div className="screen-head review-screen-head">
        <div>
          <h1 className="title">{t("reviewScreen.title")}</h1>
        </div>
        <div className="screen-actions review-screen-head-actions">
          <ReviewFilterMenu {...filterMenuProps} />
          <div className="review-filter-summary-wrap">
            <span className="review-filter-label">{t("common.status")}</span>
            <div className="review-progress-shortcuts">
              <ReviewMoreActionsMenu
                isOpen={isReviewMoreActionsMenuOpen}
                isReviewFilterMenuOpen={filterMenuProps.isReviewFilterMenuOpen}
                isReviewQueueShortcutDisabled={isReviewQueueShortcutDisabled}
                onCloseReviewFilterMenu={filterMenuProps.handleCloseMenu}
                onOpenChange={onReviewMoreActionsMenuOpenChange}
                onOpenReviewFilterMenu={onReviewFilterMenuOpenFromMoreActions}
                onReviewQueueShortcutClick={onReviewQueueShortcutClick}
                selectedReviewFilterTitle={filterMenuProps.selectedReviewFilterTitle}
                triggerRef={reviewMoreActionsTriggerRef}
              />
              <button
                className="badge review-progress-badge review-screen-head-badge review-queue-shortcut"
                type="button"
                aria-controls={isReviewQueuePanelOpen ? "review-queue-panel" : undefined}
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
                to={workspacePath(progressLeaderboardRoute)}
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
                to={workspacePath(progressStreakRoute)}
                aria-label={reviewProgressBadgeAriaLabel}
                title={reviewProgressBadgeAriaLabel}
                data-testid="review-progress-badge"
                aria-disabled={reviewProgressBadge.isInteractive ? undefined : "true"}
              >
                <ReviewProgressBadgeIcon />
                <span className="review-progress-badge-value">{formatReviewProgressBadgeValue(reviewProgressBadge.streakDays)}</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
      {reviewLoadErrorMessage !== "" ? <p className="error-banner">{reviewLoadErrorMessage}</p> : null}
      {reviewSpeechMessage !== "" ? <p className="review-transient-message" role="status">{reviewSpeechMessage}</p> : null}
      {reviewLoadErrorMessage !== "" && hasLoadedReviewData === false ? (
        <button className="primary-btn review-loading-retry-btn" type="button" onClick={onRetry}>
          {t("reviewScreen.actions.retry")}
        </button>
      ) : null}
    </div>
  );
}
