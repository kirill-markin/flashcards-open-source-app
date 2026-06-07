import { useEffect, useState, type ReactElement } from "react";
import { isAuthRedirectError, updateAccountPreferences } from "../../api";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import type { AccountPreferences } from "../../types";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function ReviewAnimationsSettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    isSessionVerified,
    refreshAccountPreferences,
    session,
    setAccountPreferences,
  } = useAppData();
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const reviewReactionAnimationsEnabled = session?.preferences.reviewReactionAnimationsEnabled !== false;
  const isToggleDisabled = isSubmitting || isSessionVerified === false || session === null;

  useEffect(() => {
    if (session === null || isSessionVerified === false) {
      return;
    }

    let isCancelled = false;

    async function refreshPreferencesOnOpen(): Promise<void> {
      try {
        await refreshAccountPreferences();
        if (isCancelled === false) {
          setErrorMessage("");
        }
      } catch (error) {
        if (isCancelled || isAuthRedirectError(error)) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    void refreshPreferencesOnOpen();

    return () => {
      isCancelled = true;
    };
  }, [isSessionVerified, refreshAccountPreferences, session?.userId]);

  function capturePreferenceOperationError(error: unknown, operation: "account_preferences_refresh" | "account_preferences_update"): void {
    captureAppOperationError(error, {
      feature: "settings",
      operation,
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: null,
    });
  }

  async function refreshPreferencesAfterPatch(): Promise<void> {
    try {
      await refreshAccountPreferences();
      setErrorMessage("");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      capturePreferenceOperationError(error, "account_preferences_refresh");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function persistReviewAnimationsPreference(nextEnabled: boolean): Promise<void> {
    if (session === null) {
      setErrorMessage(t("app.sessionUnavailable"));
      return;
    }

    if (isSessionVerified === false) {
      setErrorMessage(t("app.sessionRestoringActionLocked"));
      return;
    }

    const targetUserId = session.userId;
    const previousPreferences = session.preferences;
    const nextPreferences: AccountPreferences = {
      reviewReactionAnimationsEnabled: nextEnabled,
    };

    setIsSubmitting(true);
    setErrorMessage("");
    setAccountPreferences(targetUserId, nextPreferences);

    try {
      const response = await updateAccountPreferences(nextPreferences);
      setAccountPreferences(targetUserId, response.preferences);
      await refreshPreferencesAfterPatch();
    } catch (error) {
      setAccountPreferences(targetUserId, previousPreferences);
      if (isAuthRedirectError(error)) {
        return;
      }

      capturePreferenceOperationError(error, "account_preferences_update");
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SettingsShell
      title={t("reviewAnimationsSettings.title")}
      subtitle={t("reviewAnimationsSettings.subtitle")}
      activeTab="general"
    >
      <SettingsGroup>
        <article className="content-card settings-toggle-card" data-testid="review-animations-settings-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("reviewAnimationsSettings.toggleTitle")}</strong>
            <p className="subtitle">{t("reviewAnimationsSettings.toggleDescription")}</p>
          </div>
          <button
            className="settings-toggle-control"
            type="button"
            role="switch"
            aria-label={t("reviewAnimationsSettings.toggleTitle")}
            aria-checked={reviewReactionAnimationsEnabled}
            disabled={isToggleDisabled}
            data-state={reviewReactionAnimationsEnabled ? "on" : "off"}
            data-testid="review-animations-toggle"
            onClick={() => void persistReviewAnimationsPreference(!reviewReactionAnimationsEnabled)}
          >
            <span className="settings-toggle-track" aria-hidden="true">
              <span className="settings-toggle-thumb" />
            </span>
            <span className="settings-toggle-value">
              {reviewReactionAnimationsEnabled ? t("common.on") : t("common.off")}
            </span>
          </button>
        </article>
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        {isSessionVerified === false ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
      </SettingsGroup>
    </SettingsShell>
  );
}
