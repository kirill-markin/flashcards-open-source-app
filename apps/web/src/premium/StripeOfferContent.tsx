import { useState, type ReactElement } from "react";
import { isAwaitingAnalyticsConsentDecision } from "../analytics";
import { GuestSignIn } from "../screens/settings/account/guest/GuestSignIn";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import { canCollectPaywallAnalytics, type PaywallPresentation, type PremiumContinuation } from "./stripeIntent";
import { StripeBillingFeedback } from "./StripeBillingFeedback";
import { useStripeBilling } from "./useStripeBilling";

type StripeOfferContentProps = Readonly<{
  continuation: PremiumContinuation | null;
  presentation: PaywallPresentation | null;
  isPreview: boolean;
  onContinueFree: () => void;
  onChoosePremium: () => void;
}>;

export function StripeOfferContent(props: StripeOfferContentProps): ReactElement {
  const { t, formatNumber } = useI18n();
  const { session, isSessionVerified } = useAppData();
  const billing = useStripeBilling();
  const [showPreviewMessage, setShowPreviewMessage] = useState(false);
  const offer = billing.offer;
  const guest = session?.profile.email === null;
  const price = offer?.basePrice === null || offer?.basePrice === undefined ? null
    : formatNumber(offer.basePrice.unitAmount / 100, { style: "currency", currency: offer.basePrice.currency.toUpperCase(), currencyDisplay: "code" });
  const returnUrl = new URL("/settings/subscription?premium=offer", window.location.origin);
  if (props.presentation !== null && !props.isPreview && canCollectPaywallAnalytics() && !isAwaitingAnalyticsConsentDecision()) {
    returnUrl.searchParams.set("premium_presentation_id", props.presentation.presentationId);
    returnUrl.searchParams.set("premium_entry_point", props.presentation.entryPoint);
  }
  if (props.continuation !== null) returnUrl.searchParams.set("premium_accent_color", props.continuation.accentColor);
  const creatorCopy = t("paywall.creatorSupport").split("{{creator}}");
  const isPurchasing = !props.isPreview && billing.busy && billing.status === "opening";
  const canPreviewPurchase = props.isPreview && price !== null
    && offer?.premiumAiMonthlyMessages !== null && offer?.premiumAiMonthlyMessages !== undefined
    && offer.trialEligible !== null;
  const canPurchase = props.isPreview ? canPreviewPurchase : offer?.checkoutAvailable === true && price !== null;

  function choosePremium(): void {
    if (props.isPreview) {
      setShowPreviewMessage(true);
      return;
    }
    props.onChoosePremium();
    void billing.purchase(props.continuation, props.presentation);
  }
  return <section className="premium-offer" data-testid="stripe-offer">
    <section className="premium-plan premium-free-plan" aria-labelledby="premium-free-title">
      <h3 id="premium-free-title" className="panel-subtitle">{t("paywall.freeTitle")}</h3>
      <p>{t("paywall.freeDescription")}</p>
      <p className="premium-benefit">{t("paywall.freeBenefit")}</p>
      <button type="button" className="premium-plan-button premium-free-button" data-testid="premium-continue-free" disabled={isPurchasing} onClick={props.onContinueFree}>
        {t("paywall.continueFree")}
      </button>
    </section>
    <section className="premium-plan premium-paid-plan" aria-labelledby="premium-paid-title">
      <h3 id="premium-paid-title" className="panel-subtitle">{t("stripe.offer.title")} <span aria-hidden="true">✦</span></h3>
      {price === null ? null : <p className="premium-price" data-testid="premium-price">{t("paywall.basePrice", { price })}</p>}
      <ul>
        {offer?.premiumAiMonthlyMessages === undefined || offer.premiumAiMonthlyMessages === null ? null : <li>
          {t("stripe.offer.aiBenefit", { count: formatNumber(offer.premiumAiMonthlyMessages) })}
        </li>}
        <li>{t("stripe.offer.accentBenefit")}</li>
      </ul>
      <p className="premium-creator-support">{creatorCopy[0]}<a href="https://kirill-markin.com/" target="_blank" rel="noreferrer">Kirill Markin</a>{creatorCopy[1]}</p>
      {guest ? <>
        <p>{t("stripe.offer.guestExplanation")}</p>
        {props.isPreview ? <button type="button" className="premium-plan-button premium-paid-button" data-testid="premium-add-email"
          onClick={choosePremium}>{t("stripe.offer.addEmail")}</button> : !isSessionVerified ?
          <button type="button" className="premium-plan-button premium-paid-button" disabled>{t("stripe.offer.addEmail")}</button> :
          <GuestSignIn label={t("stripe.offer.addEmail")} testId="premium-add-email"
            returnUrl={returnUrl.toString()} onStarted={props.onChoosePremium} />}
      </> : <>
        {canPurchase ? <button type="button" className="premium-plan-button premium-paid-button"
          disabled={billing.busy || !isSessionVerified} data-testid="premium-purchase"
          onClick={choosePremium}>
          {t(offer?.trialEligible === true ? "paywall.startTrial" : "stripe.offer.subscribe")}
        </button> : <p data-testid="premium-purchase-unavailable" role="status">
          {t(billing.busy ? "common.loading" : !props.isPreview && offer?.checkoutUnavailableReason === "checkout_pending" ? "stripe.checkout.delayed"
            : !props.isPreview && offer?.checkoutUnavailableReason === "existing_subscription" ? "stripe.portal.headline" : "common.unavailable")}
        </p>}
        {price === null ? null : <>
          {offer?.trialEligible === true ? <p className="premium-renewal">{t("paywall.trialPrice", { price })}</p> : null}
          <p className="premium-renewal">{t("paywall.checkoutPrice")}</p>
          <p className="premium-renewal">{t("stripe.offer.renewalDisclosure")}</p>
        </>}
        <StripeBillingFeedback />
      </>}
      {showPreviewMessage ? <p role="status" data-testid="premium-preview-message">{t("premium.previewNoPurchase")}</p> : null}
      <p className="premium-allowance">{t("stripe.offer.allowanceWindow")}</p>
    </section>
    {guest ? null : <div className="screen-actions">
      <button type="button" className="ghost-btn" data-testid="premium-refresh" disabled={props.isPreview || billing.busy || !isSessionVerified}
        onClick={() => void billing.refresh()}>{t("stripe.subscription.refresh")}</button>
      {props.isPreview ? null : <a className="ghost-btn" href="/settings/subscription" data-testid="premium-subscription-settings">{t("premium.subscription")}</a>}
    </div>}
    <nav className="premium-legal">
      <a href="https://nibomo.com/terms/" target="_blank" rel="noreferrer" data-testid="premium-terms">{t("stripe.legal.terms")}</a>
      <a href="https://nibomo.com/privacy/" target="_blank" rel="noreferrer" data-testid="premium-privacy">{t("stripe.legal.privacy")}</a>
    </nav>
  </section>;
}
