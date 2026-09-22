import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { updateAccountPreferences } from "../api";
import { useI18n } from "../i18n";
import type { AnalyticsConsentChoice } from "../types";
import {
  declineAnalyticsConsent,
  grantAnalyticsConsent,
  readAnalyticsSessionOwnerId,
  reportIdentityFreeAnalyticsEvent,
  track,
} from "./client";
import { isAnalyticsConsentBannerVisible, subscribeToAnalyticsConsent } from "./consent";

const privacyPolicyUrl: string = "https://nibomo.com/privacy/";

/** Published on `:root`; the layouts that must leave room for the strip read it as bottom padding. */
const bannerHeightCustomProperty: string = "--analytics-consent-banner-height";

/**
 * Writes the answer to the account too, for a person who is already signed in when they answer.
 * Without it the account copy waits for the next page load's sign-in sync, and until then the same
 * person is measured under the old answer on their other devices.
 *
 * The verified account is read from the analytics runtime rather than from React state, because this
 * banner is rendered above the app data provider so that every public route asks on the same terms;
 * `readAnalyticsSessionOwnerId` is set by the session layer on the line beside the sync itself and is
 * null for a visitor who is not signed in. Never awaited and failure-tolerant like the rest of the
 * analytics path: the browser's own answer is already recorded, and the next verified session
 * reconciles the two.
 */
function persistAccountConsentInBackground(decision: AnalyticsConsentChoice): void {
  if (readAnalyticsSessionOwnerId() === null) {
    return;
  }

  void updateAccountPreferences({ analyticsConsent: decision }).catch((): void => undefined);
}

/**
 * Asks for analytics cookie consent where the law requires it, and only there: the backend answers
 * whether this browser has to be asked, and the two buttons are the only way past it.
 *
 * A strip along the bottom rather than a modal. The page underneath stays readable and usable,
 * because a banner that blocks the product is a banner people click through to get rid of, and an
 * answer given to make something go away is not much of an answer. Nothing is pre-selected,
 * dismissing it is not an option offered at all, and the two buttons sit side by side on one layer
 * at the same size. Allow wears the accent like every primary action in the app; Decline stays a
 * full button with full-contrast text, so refusing is never harder to find or to press than agreeing.
 *
 * Rendered at the app root, so a visitor on the public catalog, invite and share routes is asked on
 * the same terms as a signed-in person.
 */
export function AnalyticsConsentBanner(): ReactElement | null {
  const { t } = useI18n();
  const isVisible = useSyncExternalStore(subscribeToAnalyticsConsent, isAnalyticsConsentBannerVisible);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const bannerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isVisible === false) {
      return;
    }

    reportIdentityFreeAnalyticsEvent("consent_prompt_shown");
  }, [isVisible]);

  /**
   * Publishes how much of the bottom edge the strip is using, for as long as it is up. It is fixed,
   * so nothing in the layout would otherwise know it is there — and what sits at the bottom of the
   * shell is the review rating dock, the primary action of the product. The height is measured
   * rather than declared because the strip wraps its buttons on a narrow screen and grows an error
   * line, and it is republished on every resize for the same reason.
   */
  useEffect(() => {
    const banner: HTMLElement | null = bannerRef.current;
    const rootStyle = document.documentElement.style;
    if (isVisible === false || banner === null) {
      return;
    }
    // A hoisted function declaration does not keep the null check above, so the strip is captured
    // here as a non-null element for the measurement to read.
    const measuredBanner: HTMLElement = banner;

    function publishBannerHeight(): void {
      rootStyle.setProperty(bannerHeightCustomProperty, `${measuredBanner.offsetHeight}px`);
    }

    publishBannerHeight();
    // Absent in jsdom and in a few older engines. The measurement above already covers the strip as
    // it was rendered, and nothing on the consent path may throw at the person answering it.
    if (typeof ResizeObserver === "undefined") {
      return (): void => {
        rootStyle.removeProperty(bannerHeightCustomProperty);
      };
    }

    const observer = new ResizeObserver(publishBannerHeight);
    // The border box, which is what `offsetHeight` reports: the fixed layer's own bottom inset is
    // part of what covers the page, and the narrow-screen breakpoint changes only that padding.
    observer.observe(measuredBanner, { box: "border-box" });
    return (): void => {
      observer.disconnect();
      rootStyle.removeProperty(bannerHeightCustomProperty);
    };
  }, [isVisible, errorMessage]);

  async function allowAnalytics(): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const wasGranted = await grantAnalyticsConsent();
      if (wasGranted === false) {
        setErrorMessage(t("analyticsConsentBanner.error"));
        return;
      }

      track({ name: "consent_granted" });
      persistAccountConsentInBackground("granted");
    } catch {
      // The banner stays up with the failure named on it: an answer the server did not record is
      // not an answer, and nothing about analytics may reach the app's error surfaces.
      setErrorMessage(t("analyticsConsentBanner.error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function declineAnalytics(): Promise<void> {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      await declineAnalyticsConsent();
      reportIdentityFreeAnalyticsEvent("consent_declined");
      persistAccountConsentInBackground("declined");
    } catch {
      setErrorMessage(t("analyticsConsentBanner.error"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isVisible === false) {
    return null;
  }

  return (
    <aside
      ref={bannerRef}
      className="analytics-consent-banner"
      role="region"
      aria-label={t("analyticsConsentBanner.label")}
      data-testid="analytics-consent-banner"
    >
      <div className="analytics-consent-banner-inner">
        <div className="analytics-consent-banner-copy">
          <p className="analytics-consent-banner-message">{t("analyticsConsentBanner.message")}</p>
          <a
            className="analytics-consent-banner-link"
            href={privacyPolicyUrl}
            rel="noreferrer"
            target="_blank"
          >
            {t("analyticsConsentBanner.privacyPolicy")}
          </a>
        </div>
        <div className="analytics-consent-banner-actions">
          <button
            className="primary-btn analytics-consent-banner-btn"
            type="button"
            disabled={isSubmitting}
            onClick={() => void allowAnalytics()}
            data-testid="analytics-consent-allow"
          >
            {t("analyticsConsentBanner.allow")}
          </button>
          <button
            className="ghost-btn analytics-consent-banner-btn analytics-consent-banner-decline"
            type="button"
            disabled={isSubmitting}
            onClick={() => void declineAnalytics()}
            data-testid="analytics-consent-decline"
          >
            {t("analyticsConsentBanner.decline")}
          </button>
        </div>
        {errorMessage === "" ? null : (
          <p className="error-banner analytics-consent-banner-error" role="alert" data-testid="analytics-consent-error">{errorMessage}</p>
        )}
      </div>
    </aside>
  );
}
