import { useEffect, useRef, useState, type ReactElement } from "react";
import { isAuthRedirectError, updateAccountPreferences } from "../../api";
import { beginAccountPreferenceWrite, finishAccountPreferenceWrite, isCurrentAccountPreferenceWrite } from "../../appData/session/accentColorWrite";
import { useAppData } from "../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { usePremiumPresenter } from "../../premium/PremiumProvider";
import { createPremiumContinuationGuard } from "../../premium/styleSettings";
import { appThemes, useAccountTheme } from "../../premium/theme";
import type { AppTheme } from "../../types/account";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function ThemeSettingsScreen(): ReactElement {
  const {
    activeWorkspace,
    cloudSettings,
    isSessionVerified,
    refreshAccountPreferences,
    session,
    setAccountPreferences,
  } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const presentPremium = usePremiumPresenter();
  const { effectiveTheme, canCustomize } = useAccountTheme();
  const mountedRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const isChoiceDisabled = isSubmitting || isSessionVerified === false || session === null;
  const technicalErrorMessage = t("appError.technicalError.message");

  useEffect(() => {
    mountedRef.current = true;
    return (): void => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (session === null || isSessionVerified === false) {
      return;
    }

    let isCancelled = false;

    async function refreshPreferencesOnOpen(): Promise<void> {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      try {
        await refreshAccountPreferences();
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isCancelled === false) {
          setErrorMessage("");
        }
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCancelled || isAuthRedirectError(error)) {
          return;
        }

        const wasCaptured = capturePreferenceOperationError(error, "account_preferences_refresh");
        if (wasCaptured) {
          showCapturedTechnicalError(error);
          setErrorMessage(technicalErrorMessage);
        } else {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void refreshPreferencesOnOpen();

    return () => {
      isCancelled = true;
    };
  }, [indexedDbOpenRecoveryState, isSessionVerified, refreshAccountPreferences, session?.userId]);

  function capturePreferenceOperationError(error: unknown, operation: "account_preferences_refresh" | "account_preferences_update"): boolean {
    return captureAppOperationError(error, {
      feature: "settings",
      operation,
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: null,
    });
  }

  async function refreshPreferencesAfterPatch(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    try {
      await refreshAccountPreferences();
      indexedDbOpenRecoveryState.throwIfFailed();
      setErrorMessage("");
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (isAuthRedirectError(error)) {
        return;
      }

      const wasCaptured = capturePreferenceOperationError(error, "account_preferences_refresh");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function persistTheme(nextTheme: AppTheme): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const currentSession = sessionRef.current;
    if (currentSession === null) {
      setErrorMessage(t("app.sessionUnavailable"));
      return;
    }

    if (isSessionVerified === false) {
      setErrorMessage(t("app.sessionRestoringActionLocked"));
      return;
    }

    const targetUserId = currentSession.userId;
    const previousTheme = currentSession.preferences.theme;
    const write = beginAccountPreferenceWrite(targetUserId, "theme");

    setIsSubmitting(true);
    setErrorMessage("");
    setAccountPreferences(targetUserId, { theme: nextTheme });

    try {
      const response = await updateAccountPreferences({ theme: nextTheme });
      indexedDbOpenRecoveryState.throwIfFailed();
      if (!isCurrentAccountPreferenceWrite(write)) {
        return;
      }
      setAccountPreferences(targetUserId, { theme: response.preferences.theme });
      await refreshPreferencesAfterPatch();
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      if (!isCurrentAccountPreferenceWrite(write)) {
        return;
      }
      setAccountPreferences(targetUserId, { theme: previousTheme });
      if (isAuthRedirectError(error)) {
        return;
      }

      const wasCaptured = capturePreferenceOperationError(error, "account_preferences_update");
      if (wasCaptured) {
        showCapturedTechnicalError(error);
        setErrorMessage(technicalErrorMessage);
      } else {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      finishAccountPreferenceWrite(write);
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        setIsSubmitting(false);
      }
    }
  }

  function chooseTheme(nextTheme: AppTheme): void {
    if (canCustomize) {
      void persistTheme(nextTheme);
      return;
    }
    // Writing Dark here would overwrite the retained premium selection that resubscription restores.
    if (nextTheme === "dark") {
      return;
    }
    const initiatingSession = sessionRef.current;
    if (initiatingSession === null) return;
    const isCurrentContinuation = createPremiumContinuationGuard(initiatingSession, () => sessionRef.current);
    presentPremium?.({
      reason: "feature",
      entryPoint: "theme",
      requiredRank: 20,
      continuation: null,
      onResult: (result): void => {
        if (result !== "granted" || !mountedRef.current || !isCurrentContinuation()) return;
        void persistTheme(nextTheme);
      },
    });
  }

  return (
    <SettingsShell title={t("themeSettings.title")} subtitle={t("themeSettings.subtitle")} activeTab="general">
      {!canCustomize ? (
        <SettingsGroup>
          <p className="subtitle" data-testid="theme-premium-note">{t("themeSettings.premiumNote")}</p>
          <button className="primary-btn" type="button" data-testid="theme-premium-open" onClick={() => presentPremium?.({ reason: "offer", entryPoint: "theme" })}>
            {t("premium.offer")}
          </button>
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        <fieldset className="accent-presets" disabled={isChoiceDisabled}>
          <legend>{t("themeSettings.title")}</legend>
          {appThemes.map((theme) => (
            <label className="content-card accent-option" key={theme}>
              <input
                type="radio"
                name="app-theme"
                checked={effectiveTheme === theme}
                onChange={() => chooseTheme(theme)}
                data-testid={`theme-option-${theme}`}
              />
              <span>{t(`themeSettings.${theme}`)}</span>
            </label>
          ))}
        </fieldset>
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        {isSessionVerified === false ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
      </SettingsGroup>
    </SettingsShell>
  );
}
