import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { isAuthRedirectError, updateAccountPreferences } from "../../api";
import { hasPendingAccentColorWrite, queueAccentColorWrite, subscribeToAccountPreferenceWrites } from "../../appData/session/accentColorWrite";
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
  const mountedRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const isSaving = useSyncExternalStore(
    subscribeToAccountPreferenceWrites,
    () => hasPendingAccentColorWrite(session?.userId ?? null),
  );
  const isDisabled = !isSessionVerified || session === null;
  const isCustomSelected = !accentPresets.some((preset) => preset.color === selectedColor);
  const isValidCustomColor = customColor.length === 7 && /^#[0-9a-fA-F]{6}$/.test(customColor);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setCustomColor((draft) => /^#[0-9a-fA-F]{6}$/.test(draft) ? selectedColor : draft);
  }, [selectedColor]);

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

  function persistColor(color: string): void {
    const currentSession = sessionRef.current;
    if (!mountedRef.current || currentSession === null
      || !isSessionVerified || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    setCustomColor(color);
    setErrorMessage("");
    const userId = currentSession.userId;
    queueAccentColorWrite(userId, color, currentSession.preferences.accentColor, {
      apply: (nextColor): void => setAccountPreferences(userId, { accentColor: nextColor }),
      save: async (nextColor, signal): Promise<string> => {
        indexedDbOpenRecoveryState.throwIfFailed();
        const response = await updateAccountPreferences({ accentColor: nextColor }, { userId, signal });
        indexedDbOpenRecoveryState.throwIfFailed();
        return response.preferences.accentColor;
      },
      onError: (error): void => showPreferenceError(error, "account_preferences_update"),
    });
  }

  function chooseColor(color: string): void {
    if (isDisabled) {
      return;
    }
    if (color === defaultAccentColor || canCustomize) {
      persistColor(color);
      return;
    }
    const generation = readEntitlementIdentityGeneration();
    presentPremium?.({
      reason: "feature",
      requiredRank: 20,
      onResult: (result): void => {
        if (result === "granted" && mountedRef.current && generation === readEntitlementIdentityGeneration()) {
          persistColor(color);
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
        <div className="content-card accent-custom" data-selected={isCustomSelected}>
          {isCustomSelected ? (
            <span className="badge accent-custom-selected" data-testid="accent-custom-selected">
              <span aria-hidden="true">✓</span>
              {t("common.active")}
            </span>
          ) : null}
          <label className="accent-custom-picker">
            {t("accentColorSettings.custom")}
            <input
              type="color"
              value={isValidCustomColor ? customColor : selectedColor}
              disabled={isDisabled}
              onChange={(event) => {
                const color = event.target.value.toUpperCase();
                setCustomColor(color);
                chooseColor(color);
              }}
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
              onChange={(event) => {
                const draft = event.target.value;
                setCustomColor(draft);
                if (/^#[0-9a-fA-F]{6}$/.test(draft)) {
                  chooseColor(draft.toUpperCase());
                }
              }}
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
        </div>
        <p className="subtitle" data-testid="accent-current-color">{t("accentColorSettings.current", { color: effectiveColor })}</p>
        {isSaving ? <p className="subtitle" role="status">{t("accentColorSettings.saving")}</p> : null}
        {errorMessage !== "" ? <p className="error-banner" role="alert">{errorMessage}</p> : null}
        {!isSessionVerified ? <p className="subtitle">{t("loading.restoringSession")}</p> : null}
      </SettingsGroup>
    </SettingsShell>
  );
}
