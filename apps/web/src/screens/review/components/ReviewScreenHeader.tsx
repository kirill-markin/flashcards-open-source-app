import type { ComponentProps, ReactElement } from "react";
import { Link } from "react-router-dom";
import { formatReviewProgressBadgeValue } from "../../../appData/progress/badge/reviewProgressBadge";
import { useI18n } from "../../../i18n";
import { progressLeaderboardRoute, progressRoute } from "../../../routes";
import { ProgressLeaderboardShortcutIcon, ReviewProgressBadgeIcon } from "../../shared/ReviewProgressBadgeIcon";
import { ReviewFilterMenu } from "../filters/ReviewFilterMenu";

type ReviewProgressBadgeState = Readonly<{
  hasReviewedToday: boolean;
  isInteractive: boolean;
  streakDays: number;
}>;

export type ReviewScreenHeaderProps = Readonly<{
  filterMenuProps: ComponentProps<typeof ReviewFilterMenu>;
  hasLoadedReviewData: boolean;
  onRetry: () => void;
  reviewLoadErrorMessage: string;
  reviewProgressBadge: ReviewProgressBadgeState;
  reviewSpeechMessage: string;
}>;

export function ReviewScreenHeader(props: ReviewScreenHeaderProps): ReactElement {
  const {
    filterMenuProps,
    hasLoadedReviewData,
    onRetry,
    reviewLoadErrorMessage,
    reviewProgressBadge,
    reviewSpeechMessage,
  } = props;
  const { t, formatNumber } = useI18n();
  const reviewProgressBadgeTodayStatus = reviewProgressBadge.hasReviewedToday
    ? t("reviewScreen.progressBadge.reviewedToday")
    : t("reviewScreen.progressBadge.notReviewedToday");
  const reviewProgressBadgeAriaLabel = t("reviewScreen.progressBadge.ariaLabel", {
    streak: formatNumber(reviewProgressBadge.streakDays),
    todayStatus: reviewProgressBadgeTodayStatus,
  });
  const leaderboardShortcutAriaLabel = t("reviewScreen.leaderboardShortcut.ariaLabel");

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
          <span className="review-filter-label">{t("reviewScreen.progressBadge.title")}</span>
          <div className="review-progress-shortcuts">
            <Link
              className="badge review-progress-badge review-screen-head-badge review-leaderboard-shortcut"
              to={progressLeaderboardRoute}
              aria-label={leaderboardShortcutAriaLabel}
              title={leaderboardShortcutAriaLabel}
              data-testid="review-leaderboard-shortcut"
            >
              <ProgressLeaderboardShortcutIcon />
            </Link>
            <Link
              className={`badge review-progress-badge review-screen-head-badge${reviewProgressBadge.hasReviewedToday ? " review-progress-badge-active" : ""}`}
              to={progressRoute}
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
  );
}
