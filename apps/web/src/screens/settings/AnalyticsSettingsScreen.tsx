import { type ReactElement } from "react";
import { AnalyticsConsentToggleCard, ProductAnalyticsCollectionToggleCard } from "../../analytics";
import { updateAccountPreferences } from "../../api";
import { beginAccountPreferenceWrite, finishAccountPreferenceWrite, isCurrentAccountPreferenceWrite } from "../../appData/session/accentColorWrite";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import type { AnalyticsConsentChoice } from "../../types";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function AnalyticsSettingsScreen(): ReactElement {
  const { isSessionVerified, session, setAccountPreferences } = useAppData();
  const { t } = useI18n();

  async function persistAccountConsent(decision: AnalyticsConsentChoice): Promise<void> {
    if (session === null || isSessionVerified === false) {
      return;
    }

    const write = beginAccountPreferenceWrite(session.userId, "analyticsConsent");
    try {
      const response = await updateAccountPreferences({ analyticsConsent: decision });
      if (isCurrentAccountPreferenceWrite(write)) {
        setAccountPreferences(session.userId, { analyticsConsent: response.preferences.analyticsConsent });
      }
    } finally {
      finishAccountPreferenceWrite(write);
    }
  }

  async function persistAccountCollection(isCollectionEnabled: boolean): Promise<void> {
    if (session === null || isSessionVerified === false) {
      return;
    }

    const write = beginAccountPreferenceWrite(session.userId, "productAnalyticsEnabled");
    try {
      const response = await updateAccountPreferences({ productAnalyticsEnabled: isCollectionEnabled });
      if (isCurrentAccountPreferenceWrite(write)) {
        setAccountPreferences(session.userId, { productAnalyticsEnabled: response.preferences.productAnalyticsEnabled });
      }
    } finally {
      finishAccountPreferenceWrite(write);
    }
  }

  return (
    <SettingsShell
      title={t("analyticsSettings.title")}
      subtitle={t("analyticsSettings.subtitle")}
      activeTab="general"
    >
      <SettingsGroup>
        <ProductAnalyticsCollectionToggleCard persistAccountCollection={persistAccountCollection} />
        <AnalyticsConsentToggleCard persistAccountConsent={persistAccountConsent} />
      </SettingsGroup>
    </SettingsShell>
  );
}
