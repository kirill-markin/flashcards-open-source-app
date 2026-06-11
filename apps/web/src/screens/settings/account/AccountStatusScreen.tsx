import { useEffect, useState, type ReactElement } from "react";
import {
  buildLogoutUrl,
  isAuthRedirectError,
  loadCommunityProfile,
  updateCommunityProfile,
} from "../../../api";
import { useAppData } from "../../../appData";
import {
  clearPersistedProgressLeaderboard,
} from "../../../appData/progress/storage/progressStorage";
import {
  invalidateServerProgress,
} from "../../../appData/progress/invalidation/progressInvalidation";
import { useI18n } from "../../../i18n";
import { captureAppOperationError } from "../../../observability/appOperationObservation";
import type { CommunityPublicProfile } from "../../../types";
import { SettingsShell } from "../SettingsShared";

function formatCloudStateTitle(cloudState: string | null, t: (key: "accountStatus.states.linked" | "accountStatus.states.linkingReady" | "accountStatus.states.disconnected") => string): string {
  if (cloudState === "linked") {
    return t("accountStatus.states.linked");
  }

  if (cloudState === "linking-ready") {
    return t("accountStatus.states.linkingReady");
  }

  return t("accountStatus.states.disconnected");
}

export function AccountStatusScreen(): ReactElement {
  const { activeWorkspace, cloudSettings, isSessionVerified, session } = useAppData();
  const { t, formatDateTime } = useI18n();
  const [communityProfile, setCommunityProfile] = useState<CommunityPublicProfile | null>(null);
  const [communityProfileErrorMessage, setCommunityProfileErrorMessage] = useState<string>("");
  const [isCommunityProfileSubmitting, setIsCommunityProfileSubmitting] = useState<boolean>(false);
  const unavailableLabel = t("common.unavailable");
  const accountEmail: string | null = cloudSettings?.linkedEmail ?? session?.profile.email ?? null;
  const accountEmailLabel: string = accountEmail ?? unavailableLabel;
  const leaderboardParticipationEnabled = communityProfile?.leaderboardParticipationEnabled === true;
  const isParticipationToggleDisabled = isCommunityProfileSubmitting
    || communityProfile === null
    || isSessionVerified === false
    || session === null;

  function captureCommunityProfileOperationError(
    error: unknown,
    operation: "community_profile_refresh" | "community_profile_update",
  ): void {
    captureAppOperationError(error, {
      feature: "settings",
      operation,
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: null,
    });
  }

  useEffect(() => {
    if (session === null || isSessionVerified === false) {
      return;
    }

    let isCancelled = false;

    async function refreshCommunityProfileOnOpen(): Promise<void> {
      try {
        const profile = await loadCommunityProfile();
        if (isCancelled === false) {
          setCommunityProfile(profile);
          setCommunityProfileErrorMessage("");
        }
      } catch (error) {
        if (isCancelled || isAuthRedirectError(error)) {
          return;
        }

        captureCommunityProfileOperationError(error, "community_profile_refresh");
        setCommunityProfileErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void refreshCommunityProfileOnOpen();

    return () => {
      isCancelled = true;
    };
  }, [isSessionVerified, session?.userId]);

  async function persistLeaderboardParticipation(nextEnabled: boolean): Promise<void> {
    if (session === null) {
      setCommunityProfileErrorMessage(t("app.sessionUnavailable"));
      return;
    }

    if (isSessionVerified === false) {
      setCommunityProfileErrorMessage(t("app.sessionRestoringActionLocked"));
      return;
    }

    const previousProfile = communityProfile;
    if (previousProfile === null) {
      return;
    }

    setIsCommunityProfileSubmitting(true);
    setCommunityProfileErrorMessage("");
    setCommunityProfile({
      ...previousProfile,
      leaderboardParticipationEnabled: nextEnabled,
    });

    try {
      const updatedProfile = await updateCommunityProfile({
        leaderboardParticipationEnabled: nextEnabled,
      });
      setCommunityProfile(updatedProfile);
      // Drop the cached leaderboard payload and invalidate server progress so the
      // Progress tab refetches immediately instead of serving the stale cached
      // payload until its nextRefreshAfter gate expires.
      clearPersistedProgressLeaderboard();
      invalidateServerProgress();
    } catch (error) {
      setCommunityProfile(previousProfile);
      if (isAuthRedirectError(error)) {
        return;
      }

      captureCommunityProfileOperationError(error, "community_profile_update");
      setCommunityProfileErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCommunityProfileSubmitting(false);
    }
  }

  return (
    <SettingsShell
      title={t("accountStatus.title")}
      subtitle={t("accountStatus.subtitle")}
      activeTab="account"
    >
      <div className="settings-detail-grid">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.email")}</span>
          <span data-testid="account-status-email-value" hidden>{accountEmail ?? ""}</span>
          <strong
            className="panel-subtitle"
            data-testid="account-status-email"
            data-email={accountEmail ?? ""}
          >
            {accountEmailLabel}
          </strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.accountState")}</span>
          <strong className="panel-subtitle">{formatCloudStateTitle(cloudSettings?.cloudState ?? null, t)}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.authTransport")}</span>
          <strong className="panel-subtitle">{session?.authTransport ?? unavailableLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.workspaceLink")}</span>
          <strong className="panel-subtitle">{cloudSettings?.linkedWorkspaceId ?? unavailableLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.updated")}</span>
          <strong className="panel-subtitle txn-cell-mono">
            {cloudSettings?.updatedAt === undefined || cloudSettings.updatedAt === null ? unavailableLabel : formatDateTime(cloudSettings.updatedAt)}
          </strong>
        </article>
      </div>

      <article className="content-card settings-toggle-card" data-testid="leaderboard-participation-card">
        <div className="settings-nav-card-copy">
          <strong className="panel-subtitle">{t("accountStatus.leaderboardParticipation.title")}</strong>
          <p className="subtitle">{t("accountStatus.leaderboardParticipation.description")}</p>
        </div>
        <button
          className="settings-toggle-control"
          type="button"
          role="switch"
          aria-label={t("accountStatus.leaderboardParticipation.title")}
          aria-checked={leaderboardParticipationEnabled}
          disabled={isParticipationToggleDisabled}
          data-state={leaderboardParticipationEnabled ? "on" : "off"}
          data-testid="leaderboard-participation-toggle"
          onClick={() => void persistLeaderboardParticipation(leaderboardParticipationEnabled === false)}
        >
          <span className="settings-toggle-track" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
          <span className="settings-toggle-value">
            {leaderboardParticipationEnabled ? t("common.on") : t("common.off")}
          </span>
        </button>
      </article>
      {communityProfileErrorMessage !== "" ? (
        <p className="error-banner" role="alert">{communityProfileErrorMessage}</p>
      ) : null}

      <div className="screen-actions">
        <a className="ghost-btn" href={buildLogoutUrl()}>
          {t("accountStatus.logout")}
        </a>
      </div>
    </SettingsShell>
  );
}
