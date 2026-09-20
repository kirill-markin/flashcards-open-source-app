import { useState, useSyncExternalStore, type ReactElement } from "react";
import {
  declineAnalyticsConsent,
  grantAnalyticsConsent,
  readAnalyticsConsentDecision,
  reportIdentityFreeAnalyticsEvent,
  subscribeToAnalyticsConsent,
  track,
} from "../../analytics";
import { updateAccountPreferences } from "../../api";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import type { AnalyticsConsentChoice } from "../../types";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

/**
 * Changing the analytics consent decision later, which is what makes the answer on the banner a
 * decision rather than a one-way door.
 *
 * It is here in every region, not only where a banner is shown: the published privacy policy states
 * withdrawal without a regional qualifier, so a control offered only in consent countries would make
 * that text false everywhere else. A browser that was never asked reads as consented, because it was
 * measured under a jurisdiction that requires no asking; turning this off is the withdrawal.
 *
 * It works signed out as well. The decision belongs to the browser first and is carried to the
 * account whenever one is signed in, so this screen writes both where it can.
 */
export function AnalyticsSettingsScreen(): ReactElement {
  const { isSessionVerified, session, setAccountPreferences } = useAppData();
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const consentDecision = useSyncExternalStore(subscribeToAnalyticsConsent, readAnalyticsConsentDecision);
  const isAnalyticsAllowed = consentDecision !== "declined";
  const isToggleDisabled = isSubmitting;

  async function persistAccountConsent(decision: AnalyticsConsentChoice): Promise<void> {
    if (session === null || isSessionVerified === false) {
      return;
    }

    // Only the field this screen owns is written, and the account copy follows the browser's own
    // decision rather than replacing it: the browser is where the measurement happens.
    const response = await updateAccountPreferences({ analyticsConsent: decision });
    setAccountPreferences(session.userId, response.preferences);
  }

  async function changeAnalyticsConsent(nextAllowed: boolean): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      if (nextAllowed) {
        const wasGranted = await grantAnalyticsConsent();
        if (wasGranted === false) {
          setErrorMessage(t("analyticsSettings.error"));
          return;
        }

        track({ name: "consent_granted" });
        await persistAccountConsent("granted");
        return;
      }

      await declineAnalyticsConsent();
      reportIdentityFreeAnalyticsEvent("consent_declined");
      await persistAccountConsent("declined");
    } catch {
      // The switch shows what this browser actually stores, so a failed account write is reported
      // here rather than rolled back: the next verified session syncs the two.
      setErrorMessage(t("analyticsSettings.error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SettingsShell
      title={t("analyticsSettings.title")}
      subtitle={t("analyticsSettings.subtitle")}
      activeTab="general"
    >
      <SettingsGroup>
        <article className="content-card settings-toggle-card" data-testid="analytics-consent-card">
          <div className="settings-nav-card-copy">
            <strong className="panel-subtitle">{t("analyticsSettings.toggleTitle")}</strong>
            <p className="subtitle">{t("analyticsSettings.toggleDescription")}</p>
          </div>
          <button
            className="settings-toggle-control"
            type="button"
            role="switch"
            aria-label={t("analyticsSettings.toggleTitle")}
            aria-checked={isAnalyticsAllowed}
            disabled={isToggleDisabled}
            data-state={isAnalyticsAllowed ? "on" : "off"}
            data-testid="analytics-consent-toggle"
            onClick={() => void changeAnalyticsConsent(isAnalyticsAllowed === false)}
          >
            <span className="settings-toggle-track" aria-hidden="true">
              <span className="settings-toggle-thumb" />
            </span>
            <span className="settings-toggle-value">
              {isAnalyticsAllowed ? t("common.on") : t("common.off")}
            </span>
          </button>
        </article>
        {errorMessage === "" ? null : <p className="error-banner" role="alert">{errorMessage}</p>}
      </SettingsGroup>
    </SettingsShell>
  );
}
