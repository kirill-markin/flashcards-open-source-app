import type { ReactElement } from "react";
import { buildLoginUrl } from "../api";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import type { PremiumContinuation } from "./stripeIntent";
import { StripeBillingFeedback } from "./StripeBillingFeedback";
import { useStripeBilling } from "./useStripeBilling";

export function StripeOfferContent(props: Readonly<{ continuation: PremiumContinuation | null }>): ReactElement {
  const { t, formatNumber, locale } = useI18n();
  const { session, isSessionVerified } = useAppData();
  const billing = useStripeBilling();
  const offer = billing.offer;
  const guest = session?.profile.email === null;
  const price = offer?.basePrice === null || offer?.basePrice === undefined ? null
    : formatNumber(offer.basePrice.unitAmount / 100, { style: "currency", currency: offer.basePrice.currency.toUpperCase() });
  const loginUrl = buildLoginUrl(`${window.location.origin}/settings/subscription?premium=offer`, locale);
  return <section className="premium-offer" data-testid="stripe-offer">
    <h3 className="panel-subtitle">{t("stripe.offer.title")}</h3>
    <p className="subtitle">{t("stripe.offer.description")}</p>
    <ul>
      {offer?.premiumAiMonthlyMessages === undefined || offer.premiumAiMonthlyMessages === null ? null : <li>
        {t("stripe.offer.aiBenefit", { count: formatNumber(offer.premiumAiMonthlyMessages) })}
      </li>}
      <li>{t("stripe.offer.accentBenefit")}</li>
    </ul>
    <p className="subtitle">{t("stripe.offer.syncClarification")}</p>
    <p className="subtitle">{t("stripe.offer.allowanceWindow")}</p>
    {guest ? <>
      <p className="subtitle">{t("stripe.offer.guestExplanation")}</p>
      <a className="primary-btn" href={loginUrl} data-testid="premium-add-email">{t("stripe.offer.addEmail")}</a>
    </> : <>
      {price === null ? null : <>
        <p className="premium-price" data-testid="premium-price">{t(offer?.trialEligible === true ? "stripe.offer.trial" : "stripe.offer.price", { price })}</p>
        <p className="subtitle">{t("stripe.offer.taxDisclosure")}</p>
        {offer?.trialEligible === true ? <p className="subtitle">{t("stripe.offer.trialDisclosure", { price })}</p> : null}
        <p className="subtitle">{t("stripe.offer.trialEligibility")}</p>
        <p className="subtitle">{t("stripe.offer.renewalDisclosure")}</p>
      </>}
      {offer?.checkoutAvailable === true && price !== null ? <button type="button" className="primary-btn"
        disabled={billing.busy || !isSessionVerified} data-testid="premium-purchase"
        onClick={() => void billing.purchase(props.continuation)}>
        {t(offer.trialEligible === true ? "stripe.offer.startTrial" : "stripe.offer.subscribe")}
      </button> : <p className="subtitle" data-testid="premium-purchase-unavailable">
        {t(offer?.checkoutUnavailableReason === "checkout_pending" ? "stripe.checkout.delayed"
          : offer?.checkoutUnavailableReason === "existing_subscription" ? "stripe.portal.headline" : "common.unavailable")}
      </p>}
      <StripeBillingFeedback />
      <div className="screen-actions">
        <button type="button" className="ghost-btn" data-testid="premium-refresh" disabled={billing.busy || !isSessionVerified}
          onClick={() => void billing.refresh()}>{t("stripe.subscription.refresh")}</button>
        <a className="ghost-btn" href="/settings/subscription" data-testid="premium-subscription-settings">{t("premium.subscription")}</a>
      </div>
    </>}
    <nav className="premium-legal">
      <a href="https://nibomo.com/terms/" target="_blank" rel="noreferrer" data-testid="premium-terms">{t("stripe.legal.terms")}</a>
      <a href="https://nibomo.com/privacy/" target="_blank" rel="noreferrer" data-testid="premium-privacy">{t("stripe.legal.privacy")}</a>
    </nav>
  </section>;
}
