import type { ReactElement } from "react";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import { useEntitlementSnapshot } from "../../premium/entitlementStore";
import { usePremiumPresenter } from "../../premium/PremiumProvider";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function SubscriptionSettingsScreen(): ReactElement {
  const userId = useAppData().session?.userId ?? null;
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
        <button type="button" className="ghost-btn" data-testid="subscription-offer" onClick={() => { presentPremium?.({ reason: "offer" }); }}>
          {t("premium.offer")}
        </button>
      </SettingsGroup>
    </SettingsShell>
  );
}
