import { useState, useSyncExternalStore, type ReactElement } from "react";
import { useI18n } from "../i18n";
import type { AnalyticsConsentChoice } from "../types";
import {
  declineAnalyticsConsent,
  grantAnalyticsConsent,
  isAnalyticsEnabledForCurrentRuntime,
  reportIdentityFreeAnalyticsEvent,
  track,
} from "./client";
import { readAnalyticsConsentDecision, subscribeToAnalyticsConsent } from "./consent";

export type AnalyticsConsentToggleCardProps = Readonly<{
  /**
   * Carries the answer to the account. The browser's own decision is already written before this
   * runs, so this is the second half of the write and never the first, and a surface with no signed-in
   * account resolves without writing anything. Rejecting shows this card's error line, so a surface
   * that must not report an analytics failure swallows its own.
   */
  persistAccountConsent: (decision: AnalyticsConsentChoice) => Promise<void>;
}>;

/**
 * The analytics consent switch, and the only withdrawal control the product has. It is shared rather
 * than duplicated because the settings screen and the public-route link must be able to disagree
 * about nothing: same states, same writes, same event names.
 *
 * It is offered in every region, not only where a banner is shown: the published privacy policy
 * states withdrawal without a regional qualifier, so a control offered only in consent countries
 * would make that text false everywhere else. A browser that was never asked reads as consented,
 * because it was measured under a jurisdiction that requires no asking; turning this off is the
 * withdrawal.
 *
 * Under the operator kill switch there is nothing to allow or withdraw, and no grant could lift it,
 * so the switch is replaced by the sentence saying so rather than left to refuse every attempt.
 */
export function AnalyticsConsentToggleCard(props: AnalyticsConsentToggleCardProps): ReactElement {
  const { persistAccountConsent } = props;
  const { t } = useI18n();
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const consentDecision = useSyncExternalStore(subscribeToAnalyticsConsent, readAnalyticsConsentDecision);
  const isRuntimeEnabled = isAnalyticsEnabledForCurrentRuntime();
  const isAnalyticsAllowed = consentDecision !== "declined";

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
    <>
      <article className="content-card settings-toggle-card" data-testid="analytics-consent-card">
        <div className="settings-nav-card-copy">
          <strong className="panel-subtitle">{t("analyticsSettings.toggleTitle")}</strong>
          <p className="subtitle">
            {isRuntimeEnabled
              ? t("analyticsSettings.toggleDescription")
              : t("analyticsSettings.unavailable")}
          </p>
        </div>
        {isRuntimeEnabled === false ? null : (
          <button
            className="settings-toggle-control"
            type="button"
            role="switch"
            aria-label={t("analyticsSettings.toggleTitle")}
            aria-checked={isAnalyticsAllowed}
            disabled={isSubmitting}
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
        )}
      </article>
      {errorMessage === "" ? null : <p className="error-banner" role="alert">{errorMessage}</p>}
    </>
  );
}
