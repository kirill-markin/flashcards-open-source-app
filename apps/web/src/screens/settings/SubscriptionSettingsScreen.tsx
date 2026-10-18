import { useEffect, useRef, type ReactElement } from "react";
import { useSearchParams } from "react-router";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import { useEntitlementSnapshot } from "../../premium/entitlementStore";
import { hasPremiumAccess, usePremiumPresenter } from "../../premium/PremiumProvider";
import { StripeBillingFeedback } from "../../premium/StripeBillingFeedback";
import { clearStripeIntent, consumeGuestStripeCheckout, readPaywallReturn, readPremiumReturnContinuation, readStripeIntent } from "../../premium/stripeIntent";
import { StripeSubscriptions } from "../../premium/StripeSubscriptions";
import { useStripeBilling } from "../../premium/useStripeBilling";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function SubscriptionSettingsScreen(): ReactElement {
  const { session, isSessionVerified } = useAppData();
  const userId = session?.userId ?? null;
  const billing = useStripeBilling();
  const loadedRef = useRef(false);
  useEffect(() => {
    if (loadedRef.current || billing.busy || !isSessionVerified || session?.profile.email === null) return;
    loadedRef.current = true;
    if (billing.details === null && billing.error === null) void billing.refresh();
  }, [billing.busy, billing.details, billing.error, billing.refresh, isSessionVerified, session?.profile.email]);
  const entitlement = useEntitlementSnapshot(userId);
  const presentPremium = usePremiumPresenter();
  const { t, formatDate, formatNumber } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledReturnRef = useRef<string | null>(null);
  const showOffer = entitlement !== null && !hasPremiumAccess(entitlement, 20);
  useEffect(() => {
    if (searchParams.get("premium") === "checkout") {
      if (entitlement === null || !isSessionVerified || session?.profile.email == null || userId === null
        || billing.busy || billing.details === null || billing.error !== null) return;
      const intent = consumeGuestStripeCheckout(userId, searchParams.get("premium_checkout_token"));
      const next = new URLSearchParams(searchParams);
      for (const key of ["premium", "premium_checkout_token", "premium_presentation_id", "premium_entry_point", "premium_accent_color"]) next.delete(key);
      setSearchParams(next, { replace: true });
      if (intent === null) return;
      if (hasPremiumAccess(entitlement, 20)) {
        clearStripeIntent();
        if (intent.continuation !== null) billing.resumePremiumContinuation(intent.continuation);
      } else {
        void billing.purchase(intent.continuation, intent.presentation ?? null);
      }
      return;
    }
    if (searchParams.get("premium") !== "offer" || entitlement === null || !isSessionVerified || presentPremium === null) return;
    const returnKey = `${userId}:${searchParams.toString()}`;
    if (handledReturnRef.current === returnKey) return;
    const presentation = readPaywallReturn(searchParams);
    const result = presentPremium({ reason: "offer", entryPoint: presentation?.entryPoint ?? "guest_return", presentation, continuation: readPremiumReturnContinuation(searchParams) });
    if (result === "unavailable") return;
    handledReturnRef.current = returnKey;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("premium");
    nextSearchParams.delete("premium_presentation_id");
    nextSearchParams.delete("premium_entry_point");
    nextSearchParams.delete("premium_accent_color");
    setSearchParams(nextSearchParams, { replace: true });
  }, [billing, entitlement, isSessionVerified, presentPremium, searchParams, session?.profile.email, setSearchParams, userId]);

  return (
    <SettingsShell title={t("premium.subscription")} subtitle={t("premium.subscriptionDescription")} activeTab="account">
      <SettingsGroup>
        <article className="content-card content-card-section" data-testid="subscription-status">
          {entitlement === null ? <p className="subtitle">{t("premium.unknown")}</p> : (
            <>
              <h2 className="panel-subtitle">{entitlement.tierDisplayName}</h2>
              <p className="subtitle">
                {entitlement.status === "none" ? t("premium.statusNone")
                  : entitlement.status === "in_grace" ? t("premium.grace") : t("common.active")}
              </p>
              {entitlement.isTrial ? <p className="subtitle">{t("premium.trial")}</p> : null}
              {entitlement.status === "none" ? null : entitlement.until !== null ? (
                <p className="subtitle">
                  {t(entitlement.willRenew && entitlement.status === "active" ? "premium.renews" : "premium.until", {
                    date: formatDate(entitlement.until, { dateStyle: "long" }),
                  })}
                </p>
              ) : entitlement.status === "active" ? <p className="subtitle">{t("premium.noExpiry")}</p> : null}
              {entitlement.limits.aiMonthlyMessages !== null ? (
                <p className="subtitle">
                  {t("premium.monthlyMessages", { count: formatNumber(entitlement.limits.aiMonthlyMessages) })}
                </p>
              ) : null}
            </>
          )}
          <p className="subtitle">{t("stripe.offer.allowanceWindow")}</p>
        </article>
        <StripeSubscriptions entitlement={entitlement} />
        <StripeBillingFeedback />
        {billing.error !== null && userId !== null && readStripeIntent(userId)?.attemptId === null ? (
          <button type="button" className="primary-btn" data-testid="stripe-retry-checkout" disabled={billing.busy || !isSessionVerified}
            onClick={() => { const intent = readStripeIntent(userId); void billing.purchase(intent?.continuation ?? null, intent?.presentation ?? null); }}>
            {t("common.retry")}
          </button>
        ) : null}
        <button type="button" className="ghost-btn" data-testid="subscription-refresh" disabled={billing.busy || !isSessionVerified}
          onClick={() => void billing.refresh()}>{t("stripe.subscription.refresh")}</button>
        <div className="content-card content-card-section">
          <p className="subtitle">{t("stripe.ownKey.explanation")}</p>
          <a className="ghost-btn" href="/settings/own-openai-key" data-testid="subscription-own-key">{t("stripe.ownKey.action")}</a>
        </div>
        {showOffer ? (
          <button type="button" className="ghost-btn" data-testid="subscription-offer" onClick={() => { presentPremium?.({ reason: "offer", entryPoint: "subscription_settings" }); }}>
            {t("premium.offer")}
          </button>
        ) : null}
      </SettingsGroup>
    </SettingsShell>
  );
}
