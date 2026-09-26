import { useEffect, useRef, useState, type ReactElement } from "react";
import { isAuthRedirectError, updateAccountPreferences } from "../../api";
import { beginAccountPreferenceWrite, finishAccountPreferenceWrite, hasPendingAccentColorWrite, isCurrentAccountPreferenceWrite } from "../../appData/session/accentColorWrite";
import { useAppData } from "../../appData";
import { markIndexedDbOpenRecoveryFailureAndCheckActive, useAppErrorDialog } from "../../appError/AppErrorContext";
import { useI18n } from "../../i18n";
import { captureAppOperationError } from "../../observability/appOperationObservation";
import { accentPresets, useAccountAccentColor } from "../../premium/accentColor";
import { usePremiumPresenter } from "../../premium/PremiumProvider";
import { readEntitlementIdentityGeneration } from "../../premium/entitlementStore";
import { defaultAccentColor } from "../../types/account";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function AccentColorSettingsScreen(): ReactElement {
  const userId = useAppData().session?.userId ?? null;
  return <AccentColorEditor key={userId} />;
}

function AccentColorEditor(): ReactElement {
  const { session, activeWorkspace, cloudSettings, isSessionVerified, setAccountPreferences, refreshAccountPreferences } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { t } = useI18n();
  const presentPremium = usePremiumPresenter();
  const { selectedColor, effectiveColor, canCustomize } = useAccountAccentColor();
  const [customColor, setCustomColor] = useState(selectedColor);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const isSaving = isSubmitting || hasPendingAccentColorWrite(session?.userId ?? null);
  const isDisabled = isSaving || !isSessionVerified || session === null;
  const isValidCustomColor = customColor.length === 7 && /^#[0-9a-fA-F]{6}$/.test(customColor);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => { mountedRef.current = false; };
  }, []);

  useEffect(() => { setCustomColor(selectedColor); }, [selectedColor]);

  function showPreferenceError(error: unknown, operation: "account_preferences_refresh" | "account_preferences_update"): void {
    if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)
      || isAuthRedirectError(error)) {
      return;
    }
    const wasCaptured = captureAppOperationError(error, {
      feature: "settings",
      operation,
      userId: session?.userId ?? null,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      installationId: cloudSettings?.installationId ?? null,
      entityId: null,
    });
    if (wasCaptured || operation === "account_preferences_update") {
      showCapturedTechnicalError(error);
    }
    if (mountedRef.current) {
      setErrorMessage(wasCaptured ? t("appError.technicalError.message")
        : error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    if (session === null || !isSessionVerified || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    let cancelled = false;
    void refreshAccountPreferences().catch((error: unknown) => {
      if (!cancelled) {
        showPreferenceError(error, "account_preferences_refresh");
      }
    });
    return (): void => { cancelled = true; };
  }, [indexedDbOpenRecoveryState, isSessionVerified, refreshAccountPreferences, session?.userId]);

  async function persistColor(color: string): Promise<void> {
    const currentSession = sessionRef.current;
    if (!mountedRef.current || submittingRef.current || currentSession === null
      || hasPendingAccentColorWrite(currentSession?.userId ?? null)
      || !isSessionVerified || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    const userId = currentSession.userId;
    const previousColor = currentSession.preferences.accentColor;
    const write = beginAccountPreferenceWrite(userId, "accentColor");
    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage("");
    setAccountPreferences(userId, { accentColor: color });
    try {
      const response = await updateAccountPreferences({ accentColor: color });
      indexedDbOpenRecoveryState.throwIfFailed();
      if (isCurrentAccountPreferenceWrite(write)) {
        setAccountPreferences(userId, { accentColor: response.preferences.accentColor });
      }
    } catch (error) {
      if (isCurrentAccountPreferenceWrite(write)) {
        setAccountPreferences(userId, { accentColor: previousColor });
        showPreferenceError(error, "account_preferences_update");
      }
    } finally {
      finishAccountPreferenceWrite(write);
      submittingRef.current = false;
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }

  function chooseColor(color: string): void {
    if (isDisabled) {
      return;
    }
    if (color === defaultAccentColor || canCustomize) {
      void persistColor(color);
      return;
    }
    const generation = readEntitlementIdentityGeneration();
    presentPremium?.({
      reason: "feature",
      requiredRank: 20,
      onResult: (result): void => {
        if (result === "granted" && mountedRef.current && generation === readEntitlementIdentityGeneration()) {
          void persistColor(color);
        }
      },
    });
  }

  return (
    <SettingsShell title={t("accentColorSettings.title")} subtitle={t("accentColorSettings.subtitle")} activeTab="general">
      {!canCustomize ? (
        <SettingsGroup>
          <p className="subtitle" data-testid="accent-premium-note">{t("accentColorSettings.premiumNote")}</p>
          <button className="primary-btn" type="button" data-testid="accent-premium-open" onClick={() => presentPremium?.({ reason: "offer" })}>
            {t("premium.offer")}
          </button>
        </SettingsGroup>
      ) : null}
      <SettingsGroup>
        <fieldset className="accent-presets" disabled={isDisabled}>
          <legend>{t("accentColorSettings.title")}</legend>
          {accentPresets.map((preset) => (
            <label className="content-card accent-option" key={preset.name}>
              <input
                type="radio"
                name="accent-color"
                checked={selectedColor === preset.color}
                onChange={() => chooseColor(preset.color)}
                data-testid={`accent-preset-${preset.name}`}
              />
              <span className="accent-swatch" style={{ backgroundColor: preset.color }} aria-hidden="true" />
              <span>{t(`accentColorSettings.${preset.name}`)}</span>
              <span className="badge">{preset.color}</span>
            </label>
          ))}
        </fieldset>
      </SettingsGroup>
      <SettingsGroup title={t("accentColorSettings.custom")}>
        <form className="content-card accent-custom" onSubmit={(event) => {
          event.preventDefault();
          if (isValidCustomColor) { chooseColor(customColor.toUpperCase()); }
        }}>
          <label className="accent-custom-picker">
            {t("accentColorSettings.custom")}
            <input
              type="color"
              value={isValidCustomColor ? customColor : selectedColor}
              disabled={isDisabled}
              onChange={(event) => setCustomColor(event.target.value.toUpperCase())}
              data-testid="accent-custom-picker"
            />
          </label>
          <label className="accent-custom-hex">
            {t("accentColorSettings.hex")}
            <input
              type="text"
              className="settings-input"
              dir="ltr"
              value={customColor}
              onChange={(event) => setCustomColor(event.target.value)}
              pattern="#[0-9a-fA-F]{6}"
              maxLength={7}
              required
              spellCheck={false}
              disabled={isDisabled}
              aria-describedby="accent-hex-help"
              data-testid="accent-custom-hex"
            />
          </label>
          <p id="accent-hex-help" className="subtitle">{t("accentColorSettings.hexHelp")}</p>
          <button className="primary-btn" type="submit" disabled={isDisabled || !isValidCustomColor} data-testid="accent-custom-save">
            {t("common.save")}
          </button>
        </form>
        <p className="subtitle" data-testid="accent-current-color">{t("accentColorSettings.current", { color: effectiveColor })}</p>
        {isSaving ? <p className="subtitle" role="status">{t("accentColorSettings.saving")}</p> : null}
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        {!isSessionVerified ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
      </SettingsGroup>
    </SettingsShell>
  );
}
