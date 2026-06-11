import { useEffect, useState, type ReactElement } from "react";
import {
  isAuthRedirectError,
  loadCommunityProfile,
  updateCommunityProfile,
} from "../../api";
import { useAppData } from "../../appData";
import { invalidateServerProgress } from "../../appData/progress/invalidation/progressInvalidation";
import { clearPersistedProgressLeaderboard } from "../../appData/progress/storage/progressStorage";
import { useI18n } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type { CommunityPublicProfile } from "../../types";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function LeaderboardParticipationSettingsScreen(): ReactElement {
  const { activeWorkspace, cloudSettings, isSessionVerified, session } = useAppData();
  const { t } = useI18n();
  const [communityProfile, setCommunityProfile] = useState<CommunityPublicProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const canManageLeaderboardParticipation = cloudSettings?.cloudState === "linked";
  const leaderboardParticipationEnabled = communityProfile?.leaderboardParticipationEnabled === true;
  const isToggleDisabled = isSubmitting
    || communityProfile === null
    || isSessionVerified === false
    || session === null
    || canManageLeaderboardParticipation === false;

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
    if (canManageLeaderboardParticipation === false) {
      setCommunityProfile(null);
      setErrorMessage("");
      return;
    }

    if (session === null || isSessionVerified === false) {
      return;
    }

    let isCancelled = false;

    async function refreshCommunityProfileOnOpen(): Promise<void> {
      try {
        const profile = await loadCommunityProfile();
        if (isCancelled === false) {
          setCommunityProfile(profile);
          setErrorMessage("");
        }
      } catch (error) {
        if (isCancelled || isAuthRedirectError(error)) {
          return;
        }

        captureCommunityProfileOperationError(error, "community_profile_refresh");
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void refreshCommunityProfileOnOpen();

    return () => {
      isCancelled = true;
    };
  }, [canManageLeaderboardParticipation, isSessionVerified, session?.userId]);

  async function persistLeaderboardParticipation(nextEnabled: boolean): Promise<void> {
    if (session === null) {
      setErrorMessage(t("app.sessionUnavailable"));
      return;
    }

    if (isSessionVerified === false) {
      setErrorMessage(t("app.sessionRestoringActionLocked"));
      return;
    }

    const previousProfile = communityProfile;
    if (previousProfile === null) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
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
      // Progress tab refetches immediately instead of serving stale participation.
      clearPersistedProgressLeaderboard();
      invalidateServerProgress();
    } catch (error) {
      setCommunityProfile(previousProfile);
      if (isAuthRedirectError(error)) {
        return;
      }

      captureCommunityProfileOperationError(error, "community_profile_update");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SettingsShell
      title={t("leaderboardParticipationSettings.title")}
      subtitle={t("leaderboardParticipationSettings.subtitle")}
      activeTab="general"
    >
      <SettingsGroup>
        <article className="content-card settings-toggle-card" data-testid="leaderboard-participation-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("leaderboardParticipationSettings.toggleTitle")}</strong>
            <p className="subtitle">{t("leaderboardParticipationSettings.toggleDescription")}</p>
          </div>
          <button
            className="settings-toggle-control"
            type="button"
            role="switch"
            aria-label={t("leaderboardParticipationSettings.toggleTitle")}
            aria-checked={leaderboardParticipationEnabled}
            disabled={isToggleDisabled}
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
        {canManageLeaderboardParticipation === false ? (
          <p className="subtitle">{t("leaderboardParticipationSettings.signInRequired")}</p>
        ) : null}
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        {isSessionVerified === false ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
      </SettingsGroup>
    </SettingsShell>
  );
}
