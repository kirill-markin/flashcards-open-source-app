import { useEffect, useRef, type ReactElement } from "react";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import { useEntitlementSnapshot } from "../../premium/entitlementStore";
import { usePremiumPresenter } from "../../premium/PremiumProvider";
import { StripeOfferContent } from "../../premium/StripeOfferContent";
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
        </article>
        <StripeSubscriptions entitlement={entitlement} />
        <StripeOfferContent continuation={null} />
        <div className="content-card content-card-section">
          <p className="subtitle">{t("stripe.ownKey.explanation")}</p>
          <a className="ghost-btn" href="/settings/own-openai-key" data-testid="subscription-own-key">{t("stripe.ownKey.action")}</a>
        </div>
        <button type="button" className="ghost-btn" data-testid="subscription-offer" onClick={() => { presentPremium?.({ reason: "offer" }); }}>
          {t("premium.offer")}
        </button>
      </SettingsGroup>
    </SettingsShell>
  );
}
