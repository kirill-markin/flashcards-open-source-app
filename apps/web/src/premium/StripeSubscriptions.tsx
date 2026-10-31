import type { ReactElement } from "react";
import { track } from "../analytics";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import type { EntitlementSnapshot } from "../types/entitlement";
import { hasPremiumAccess } from "./PremiumProvider";
import { useStripeBilling } from "./useStripeBilling";

export function StripeSubscriptions(props: Readonly<{ entitlement: EntitlementSnapshot | null }>): ReactElement {
  const { t, formatDate, formatNumber, locale } = useI18n();
  const billing = useStripeBilling();
  const { isSessionVerified } = useAppData();
  const details = billing.details;
  const countryNames = new Intl.DisplayNames([locale], { type: "region" });
  const hasSubscription = details?.customers.some((customer) => customer.subscriptions.some((subscription) => !subscription.invalidated
    && (subscription.status === "active" || subscription.status === "in_grace"))) === true;
  return <section className="premium-subscriptions" data-testid="stripe-subscriptions">
    {props.entitlement?.tier === "lifetime" && hasSubscription ? <p className="subtitle">
      {t("stripe.subscription.lifetimeWithSubscription")}
    </p> : null}
    {details?.customers.map((customer) => <article className="content-card content-card-section" key={customer.identityId}
      data-testid="stripe-customer" data-identity-id={customer.identityId}>
      <h3 className="panel-subtitle">{t("stripe.subscription.stripeLabel")}</h3>
      {customer.subscriptions.map((subscription) => <div key={subscription.subscriptionId} data-testid="stripe-subscription">
        <p className="subtitle">
          {t(subscription.invalidated || subscription.status === "revoked" ? "common.revoked"
            : subscription.status === "expired" ? "stripe.subscription.expired"
              : subscription.status === "in_grace" ? "premium.grace" : "common.active")}
        </p>
        {["past_due", "unpaid", "incomplete", "paused"].includes(subscription.providerStatus) ? <p className="subtitle">
          {t("stripe.subscription.paymentProblem")}
        </p> : null}
        {subscription.isTrial && subscription.trialEnd !== null ? <p className="subtitle">
          {t("stripe.subscription.trialEnd", { date: formatDate(subscription.trialEnd, { dateStyle: "long" }) })}
        </p> : null}
        {!subscription.invalidated && subscription.status === "active" ? <p className="subtitle">
          {t(subscription.willRenew ? "stripe.subscription.renewal" : "stripe.subscription.cancelledRenewal", {
            date: formatDate(subscription.until, { dateStyle: "long" }),
          })}
        </p> : null}
      </div>)}
      <button type="button" className="ghost-btn" data-testid="stripe-manage" disabled={billing.busy || !isSessionVerified || !customer.managementAvailable}
        onClick={() => void billing.manage(customer.identityId)}>{t("stripe.subscription.manage")}</button>
    </article>)}
    {details !== null && details.pendingCheckouts.length > 0 ? <div className="content-card content-card-section" data-testid="stripe-pending-checkout">
      <p className="subtitle">{t("stripe.checkout.delayed")}</p>
      {details.pendingCheckouts.map((attempt) => <div key={attempt.attemptId} data-testid="stripe-pending-offer">
        <p>{t("stripe.checkout.originalOffer", { price: formatNumber(attempt.offer.basePrice.unitAmount / 100,
          { style: "currency", currency: attempt.offer.basePrice.currency.toUpperCase(), currencyDisplay: "code" }) })}</p>
        {attempt.offer.selectedCountry === null ? null : <p>{t("stripe.offer.pricesFor", {
          country: countryNames.of(attempt.offer.selectedCountry) ?? attempt.offer.selectedCountry })}</p>}
        {props.entitlement !== null && !hasPremiumAccess(props.entitlement, 20) ? <>
          <button type="button" className="ghost-btn" disabled={billing.busy || !isSessionVerified}
            data-testid="stripe-resume-checkout" onClick={() => void billing.resumeCheckout(attempt)}>{t("common.continue")}</button>
          {billing.regional.country !== null && attempt.offer.selectedCountry !== billing.regional.country ? (
            <button type="button" className="ghost-btn" disabled={billing.busy || !isSessionVerified
                || billing.offer?.selectedOffer?.selectedCountry !== billing.regional.country} data-testid="stripe-requote-checkout"
              onClick={() => void billing.requote(attempt.attemptId)}>{t("stripe.checkout.requote")}</button>
          ) : null}
        </> : null}
      </div>)}
    </div> : null}
    <nav className="premium-legal" aria-label={t("stripe.subscription.manage")} data-testid="subscription-mobile-management">
      <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noreferrer"
        onClick={() => track({ name: "subscription_management_opened", destination: "app_store" })}>App Store</a>
      <a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noreferrer"
        onClick={() => track({ name: "subscription_management_opened", destination: "google_play" })}>Google Play</a>
    </nav>
  </section>;
}
