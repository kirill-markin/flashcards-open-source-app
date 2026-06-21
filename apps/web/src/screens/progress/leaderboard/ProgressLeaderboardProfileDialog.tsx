import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { loadProgressLeaderboardProfile } from "../../../api";
import { useI18n } from "../../../i18n";
import type {
  ProgressLeaderboardProfile,
  ProgressLeaderboardProfileReady,
  ProgressLeaderboardWindowKey,
} from "../../../types";
import type { ProgressLeaderboardProfileDialogSeed } from "./ProgressLeaderboardPresentation";

type ProfileDialogLoadState =
  | Readonly<{ kind: "loading"; publicProfileId: string }>
  | Readonly<{ kind: "loaded"; publicProfileId: string; profile: ProgressLeaderboardProfile }>
  | Readonly<{ kind: "error"; publicProfileId: string; message: string }>;

type ProgressLeaderboardProfileDialogProps = Readonly<{
  initialProfile: ProgressLeaderboardProfileDialogSeed;
  cachedProfile: ProgressLeaderboardProfile | null;
  onProfileLoaded: (publicProfileId: string, profile: ProgressLeaderboardProfile) => void;
  onClose: () => void;
}>;

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createUtcDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

function getLeaderboardPeriodLabel(windowKey: ProgressLeaderboardWindowKey, t: ReturnType<typeof useI18n>["t"]): string {
  if (windowKey === "last_24_hours") {
    return t("progressScreen.leaderboard.periods.last24Hours");
  }

  if (windowKey === "last_3_days") {
    return t("progressScreen.leaderboard.periods.last3Days");
  }

  if (windowKey === "last_7_days") {
    return t("progressScreen.leaderboard.periods.last7Days");
  }

  if (windowKey === "last_30_days") {
    return t("progressScreen.leaderboard.periods.last30Days");
  }

  return t("progressScreen.leaderboard.periods.allTime");
}

function formatBestRatingPlacement(
  profile: ProgressLeaderboardProfileReady,
  formatNumber: ReturnType<typeof useI18n>["formatNumber"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  const placement = profile.metrics.bestRatingPlacement;
  if (placement === null) {
    return t("progressScreen.leaderboard.profile.notRanked");
  }

  return t("progressScreen.leaderboard.profile.bestRatingPlacement", {
    rank: formatNumber(placement.rank),
    period: getLeaderboardPeriodLabel(placement.windowKey, t),
  });
}

function getProfileTitle(
  initialProfile: ProgressLeaderboardProfileDialogSeed,
  profile: ProgressLeaderboardProfile | null,
): string {
  if (initialProfile.isViewer) {
    return initialProfile.displayName;
  }

  if (profile?.status === "ready") {
    return profile.friendDisplayName ?? profile.anonymousDisplayName;
  }

  return initialProfile.displayName;
}

function getProfileIdentityAnonymousName(
  initialProfile: ProgressLeaderboardProfileDialogSeed,
  profile: ProgressLeaderboardProfile | null,
): string | null {
  if (initialProfile.isViewer) {
    return profile?.status === "ready" ? profile.anonymousDisplayName : initialProfile.anonymousDisplayName;
  }

  if (profile?.status === "ready" && profile.friendDisplayName !== undefined) {
    return profile.anonymousDisplayName;
  }

  return null;
}

function getNonReadyMessage(status: ProgressLeaderboardProfile["status"], t: ReturnType<typeof useI18n>["t"]): string {
  if (status === "linked_account_required") {
    return t("progressScreen.leaderboard.profile.linkedAccountRequired");
  }

  if (status === "participation_disabled") {
    return t("progressScreen.leaderboard.profile.participationDisabled");
  }

  return t("progressScreen.leaderboard.profile.unavailable");
}

function ProgressLeaderboardProfileReadyBody(props: Readonly<{
  profile: ProgressLeaderboardProfileReady;
}>): ReactElement {
  const { profile } = props;
  const { formatCount, formatDate, formatNumber, t } = useI18n();
  const maxReviewCount = Math.max(1, ...profile.reviewActivity.days.map((day) => day.reviewCount));
  const currentStreakText = formatCount(profile.metrics.currentStreakDays, {
    one: t("progressScreen.streakLeaderboard.dayLabels.one"),
    other: t("progressScreen.streakLeaderboard.dayLabels.other"),
  });

  return (
    <>
      <div className="progress-leaderboard-profile-metrics">
        <div className="progress-leaderboard-profile-metric">
          <span className="progress-leaderboard-profile-metric-label">
            {t("progressScreen.leaderboard.profile.currentStreak")}
          </span>
          <span className="progress-leaderboard-profile-metric-value" data-testid="progress-leaderboard-profile-current-streak">
            {currentStreakText}
          </span>
        </div>
        <div className="progress-leaderboard-profile-metric">
          <span className="progress-leaderboard-profile-metric-label">
            {t("progressScreen.leaderboard.profile.bestRating")}
          </span>
          <span className="progress-leaderboard-profile-metric-value" data-testid="progress-leaderboard-profile-best-rating">
            {formatBestRatingPlacement(profile, formatNumber, t)}
          </span>
        </div>
      </div>

      <section className="progress-leaderboard-profile-activity" aria-labelledby="progress-leaderboard-profile-activity-title">
        <h3 id="progress-leaderboard-profile-activity-title" className="progress-leaderboard-profile-section-title">
          {t("progressScreen.leaderboard.profile.activityTitle")}
        </h3>
        <ul className="progress-leaderboard-profile-activity-chart" aria-label={t("progressScreen.leaderboard.profile.activityChartLabel")}>
          {profile.reviewActivity.days.map((day) => {
            const formattedDate = formatDate(createUtcDate(day.date), {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            });
            const dayLabel = t("progressScreen.leaderboard.profile.activityDayLabel", {
              date: formattedDate,
              count: formatNumber(day.reviewCount),
            });

            return (
              <li
                key={day.date}
                className="progress-leaderboard-profile-activity-day"
                aria-label={dayLabel}
                title={dayLabel}
                data-testid="progress-leaderboard-profile-activity-day"
              >
                <span
                  className="progress-leaderboard-profile-activity-bar"
                  style={{ height: `${Math.round((day.reviewCount / maxReviewCount) * 100)}%` }}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <dl className="progress-leaderboard-profile-stats">
        <div className="progress-leaderboard-profile-stat">
          <dt>{t("progressScreen.leaderboard.profile.joinedAt")}</dt>
          <dd data-testid="progress-leaderboard-profile-joined-at">
            {formatDate(profile.stats.joinedAt, { dateStyle: "medium" })}
          </dd>
        </div>
        <div className="progress-leaderboard-profile-stat">
          <dt>{t("progressScreen.leaderboard.profile.totalCards")}</dt>
          <dd data-testid="progress-leaderboard-profile-total-cards">
            {formatNumber(profile.stats.totalCards)}
          </dd>
        </div>
      </dl>
    </>
  );
}

export function ProgressLeaderboardProfileDialog(props: ProgressLeaderboardProfileDialogProps): ReactElement {
  const { cachedProfile, initialProfile, onClose, onProfileLoaded } = props;
  const { t } = useI18n();
  const [retryCount, setRetryCount] = useState<number>(0);
  const [loadState, setLoadState] = useState<ProfileDialogLoadState>({
    kind: "loading",
    publicProfileId: initialProfile.publicProfileId,
  });

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    if (cachedProfile !== null) {
      setLoadState({
        kind: "loaded",
        publicProfileId: initialProfile.publicProfileId,
        profile: cachedProfile,
      });
      return;
    }

    let isCancelled = false;
    setLoadState({
      kind: "loading",
      publicProfileId: initialProfile.publicProfileId,
    });

    async function loadProfile(): Promise<void> {
      try {
        const profile = await loadProgressLeaderboardProfile(initialProfile.publicProfileId);
        if (isCancelled) {
          return;
        }

        onProfileLoaded(initialProfile.publicProfileId, profile);
        setLoadState({
          kind: "loaded",
          publicProfileId: initialProfile.publicProfileId,
          profile,
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setLoadState({
          kind: "error",
          publicProfileId: initialProfile.publicProfileId,
          message: readErrorMessage(error),
        });
      }
    }

    void loadProfile();

    return () => {
      isCancelled = true;
    };
  }, [cachedProfile, initialProfile.publicProfileId, onProfileLoaded, retryCount]);

  const loadedProfile = cachedProfile
    ?? (
      loadState.kind === "loaded" && loadState.publicProfileId === initialProfile.publicProfileId
        ? loadState.profile
        : null
    );
  const isLoading = cachedProfile === null
    && loadState.kind === "loading"
    && loadState.publicProfileId === initialProfile.publicProfileId;
  const loadErrorMessage = cachedProfile === null
    && loadState.kind === "error"
    && loadState.publicProfileId === initialProfile.publicProfileId
    ? loadState.message
    : "";
  const dialogTitle = getProfileTitle(initialProfile, loadedProfile);
  const identityAnonymousName = getProfileIdentityAnonymousName(initialProfile, loadedProfile);
  const isFriendIdentity = initialProfile.isViewer === false
    && loadedProfile?.status === "ready"
    && loadedProfile.friendDisplayName !== undefined;

  return createPortal(
    <div className="progress-leaderboard-profile-backdrop" role="dialog" aria-modal="true" aria-labelledby="progress-leaderboard-profile-title">
      <section className="content-card progress-leaderboard-profile-dialog" data-testid="progress-leaderboard-profile-dialog">
        <div className="progress-leaderboard-profile-head">
          <div className="progress-leaderboard-profile-heading">
            <h2 id="progress-leaderboard-profile-title" className="panel-subtitle" data-testid="progress-leaderboard-profile-title">
              {dialogTitle}
            </h2>
            {identityAnonymousName === null ? null : (
              <div className="progress-leaderboard-profile-identity">
                {isFriendIdentity ? (
                  <span className="progress-leaderboard-profile-friend-label">
                    {t("progressScreen.leaderboard.profile.friendLabel")}
                  </span>
                ) : null}
                <span className="progress-leaderboard-profile-anonymous-name">
                  {identityAnonymousName}
                </span>
              </div>
            )}
          </div>
          <button
            className="ghost-btn progress-leaderboard-profile-close"
            type="button"
            onClick={onClose}
            data-testid="progress-leaderboard-profile-close"
          >
            {t("progressScreen.leaderboard.profile.close")}
          </button>
        </div>

        {isLoading ? (
          <p className="subtitle" data-testid="progress-leaderboard-profile-loading">
            {t("progressScreen.leaderboard.profile.loading")}
          </p>
        ) : null}

        {loadErrorMessage !== "" ? (
          <div className="progress-leaderboard-profile-error">
            <p className="error-banner" role="alert" data-testid="progress-leaderboard-profile-error">
              {t("progressScreen.leaderboard.profile.errorBody")}
            </p>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => setRetryCount((previousRetryCount) => previousRetryCount + 1)}
              data-testid="progress-leaderboard-profile-retry"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : null}

        {loadedProfile === null || isLoading || loadErrorMessage !== "" ? null : (
          loadedProfile.status === "ready" ? (
            <ProgressLeaderboardProfileReadyBody profile={loadedProfile} />
          ) : (
            <p className="subtitle" data-testid="progress-leaderboard-profile-non-ready">
              {getNonReadyMessage(loadedProfile.status, t)}
            </p>
          )
        )}
      </section>
    </div>,
    document.body,
  );
}
