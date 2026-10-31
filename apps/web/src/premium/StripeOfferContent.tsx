import { useRef, useState, type ReactElement } from "react";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import type { PaywallPresentation, PremiumContinuation } from "./stripeIntent";
import { pricingCountryCodes } from "./regionalCountry";
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
  const { t, formatNumber, direction, locale } = useI18n();
  const { session, isSessionVerified } = useAppData();
  const billing = useStripeBilling();
  const [showPreviewMessage, setShowPreviewMessage] = useState(false);
  const purchasePendingRef = useRef(false);
  const offer = billing.offer;
  const guest = session?.profile.email === null;
  const publicQuote = billing.regional.quote;
  const country = billing.regional.country;
  const basePrice = country === null ? null : offer?.basePrice ?? (publicQuote?.state === "offer" ? publicQuote.offer.basePrice : null);
  const price = basePrice === null ? null
    : formatNumber(basePrice.unitAmount / 100, { style: "currency", currency: basePrice.currency.toUpperCase(), currencyDisplay: "code" });
  const countryNames = new Intl.DisplayNames([locale], { type: "region" });
  const countries = pricingCountryCodes.map((code) => ({ code, name: countryNames.of(code) ?? code }))
    .sort((left, right) => left.name.localeCompare(right.name, locale));
  const actionArrow = <span className="premium-action-arrow" aria-hidden="true">{direction === "rtl" ? "←" : "→"}</span>;
  const priceCopy = t("paywall.basePrice").split("{{price}}");
  const creatorCopy = t("paywall.creatorSupport").split("{{creator}}");
  const isPurchasing = !props.isPreview && billing.busy && billing.status === "opening";
  const showsTrial = guest || offer?.trialEligible === true;
  const canPreviewPurchase = props.isPreview && price !== null
    && offer?.premiumAiMonthlyMessages !== null && offer?.premiumAiMonthlyMessages !== undefined
    && (guest || offer.trialEligible !== null);
  const canPurchase = props.isPreview ? canPreviewPurchase : offer?.checkoutAvailable === true && price !== null && country !== null && !billing.busy;

  function choosePremium(): void {
    if (props.isPreview) {
      setShowPreviewMessage(true);
      return;
    }
    if (purchasePendingRef.current || billing.busy || !isSessionVerified || !canPurchase) return;
    purchasePendingRef.current = true;
    props.onChoosePremium();
    void billing.purchase(props.continuation, props.presentation).finally(() => { purchasePendingRef.current = false; });
  }
  return <section className="premium-offer" data-testid="stripe-offer">
    <div className="content-card-section" data-testid="premium-country">
      {country === null ? null : <p aria-live="polite">{t("stripe.offer.pricesFor", { country: countryNames.of(country) ?? country })}</p>}
      <label htmlFor="premium-pricing-country">{t("stripe.offer.changeCountry")}</label>{" "}
      <select id="premium-pricing-country" data-testid="premium-country-select" value={country ?? ""}
        disabled={billing.busy && billing.status !== "loading"} onChange={(event) => billing.regional.select(event.target.value)}>
        <option value="" disabled>{t("stripe.offer.chooseCountry")}</option>
        {countries.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
      </select>
      {billing.regional.loading && offer?.basePrice == null ? <p role="status">{t("common.loading")}</p> : null}
      {billing.regional.error === null ? null : <button type="button" className="ghost-btn" data-testid="premium-country-retry"
        onClick={billing.regional.retry}>{t("common.retry")}</button>}
    </div>
    <section className="premium-plan premium-paid-plan" aria-labelledby="premium-paid-title">
      <div className="premium-plan-header">
        <h3 id="premium-paid-title" className="panel-subtitle">{t("stripe.offer.title")} <span aria-hidden="true">✦</span></h3>
        {price === null ? null : <p className="premium-price" data-testid="premium-price">{priceCopy[0]}<strong><bdi>{price}</bdi></strong>{priceCopy[1]}</p>}
      </div>
      <ul className="premium-benefits">
        {offer?.premiumAiMonthlyMessages === undefined || offer.premiumAiMonthlyMessages === null ? null : <li>
          {t("stripe.offer.aiBenefit", { count: formatNumber(offer.premiumAiMonthlyMessages) })}
        </li>}
        <li>{t("stripe.product.accentFeature")}</li>
      </ul>
      <p className="premium-creator-support">{creatorCopy[0]}<a href="https://kirill-markin.com/" target="_blank" rel="noreferrer">Kirill Markin</a>{creatorCopy[1]}</p>
      {canPurchase ? <button type="button" className="premium-plan-button premium-paid-button"
        disabled={billing.busy || !isSessionVerified} data-testid="premium-purchase" onClick={choosePremium}>
        <span>{t(showsTrial ? "paywall.startTrial" : "stripe.offer.subscribe")}</span>{actionArrow}
      </button> : <p data-testid="premium-purchase-unavailable" role="status">
        {t(billing.busy ? "common.loading" : !props.isPreview && offer?.checkoutUnavailableReason === "checkout_pending" ? "stripe.checkout.delayed"
          : !props.isPreview && offer?.checkoutUnavailableReason === "existing_subscription" ? "stripe.portal.headline" : "common.unavailable")}
      </p>}
      {price === null ? null : <div className="premium-disclosures">
        {showsTrial ? <p className="premium-renewal">{t("paywall.trialPrice", { price })}</p> : null}
        <p className="premium-renewal">
          {showsTrial ? null : <>{t("paywall.renewalDisclosure")} </>}
          {t("paywall.checkoutPrice")}
        </p>
      </div>}
      <StripeBillingFeedback />
      {showPreviewMessage ? <p role="status" data-testid="premium-preview-message">{t("premium.previewNoPurchase")}</p> : null}
    </section>
    <section className="premium-plan premium-free-plan" aria-labelledby="premium-free-title">
      <div className="premium-plan-header">
        <h3 id="premium-free-title" className="panel-subtitle">{t("paywall.freeTitle")}</h3>
        <p className="premium-free-price">{t("paywall.alwaysFree")}</p>
      </div>
      <p>{t("paywall.freeDescription")}</p>
      <ul className="premium-benefits"><li>{t("paywall.freeBenefit")}</li></ul>
      <button type="button" className="premium-plan-button premium-free-button" data-testid="premium-continue-free" disabled={isPurchasing} onClick={props.onContinueFree}>
        <span>{t("paywall.continueFree")}</span>{actionArrow}
      </button>
    </section>
    <footer className="premium-footer">
      <div className="premium-utilities">
        <button type="button" className="ghost-btn" data-testid="premium-refresh" disabled={props.isPreview || billing.busy || !isSessionVerified}
          onClick={() => { billing.regional.retry(); void billing.refresh(); }}>{t("stripe.subscription.refresh")}</button>
        {props.isPreview ? null : <a className="ghost-btn" href="/settings/subscription" data-testid="premium-subscription-settings">{t("premium.subscription")}</a>}
      </div>
      <nav className="premium-legal">
        <a href="https://nibomo.com/terms/" target="_blank" rel="noreferrer" data-testid="premium-terms">{t("stripe.legal.terms")}</a>
        <a href="https://nibomo.com/privacy/" target="_blank" rel="noreferrer" data-testid="premium-privacy">{t("stripe.legal.privacy")}</a>
      </nav>
    </footer>
  </section>;
}
