import { type ReactElement } from "react";
import { AnalyticsConsentToggleCard, ProductAnalyticsCollectionToggleCard } from "../../analytics";
import { updateAccountPreferences } from "../../api";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import type { AnalyticsConsentChoice } from "../../types";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

/**
 * The two analytics decisions, as two switches, because they are two different questions.
 *
 * The first turns product analytics off for good: while it is off this app collects and sends
 * nothing about how the product is used. The second is the cookie banner's answer, and it decides
 * only whether this browser carries the shared analytics identifier — turning it off leaves usage
 * counted, which is why it cannot stand in for the first one.
 *
 * The same pair is offered on the public catalog, invite and share routes by
 * `PublicAnalyticsConsentLink`, which reads its account owner from the analytics runtime because it
 * has no app data to read.
 *
 * `/settings/analytics` is not among the paths `App.tsx` serves above `AuthenticatedApp`, so a
 * signed-out visitor opening it is redirected to the auth origin. That is why the public control is
 * a link rendering the switches in place rather than a second route onto this screen: a route
 * declared above `AuthenticatedApp` would win for everyone and take this screen away from the person
 * it already serves.
 *
 * Both decisions belong to the browser first and are carried to the account whenever one is signed
 * in, so this screen writes both.
 */
export function AnalyticsSettingsScreen(): ReactElement {
  const { isSessionVerified, session, setAccountPreferences } = useAppData();
  const { t } = useI18n();

  async function persistAccountConsent(decision: AnalyticsConsentChoice): Promise<void> {
    if (session === null || isSessionVerified === false) {
      return;
    }

    // Only the field this switch owns is written, and the account copy follows the browser's own
    // decision rather than replacing it: the browser is where the measurement happens.
    const response = await updateAccountPreferences({ analyticsConsent: decision });
    setAccountPreferences(session.userId, response.preferences);
  }

  async function persistAccountCollection(isCollectionEnabled: boolean): Promise<void> {
    if (session === null || isSessionVerified === false) {
      return;
    }

    const response = await updateAccountPreferences({ productAnalyticsEnabled: isCollectionEnabled });
    setAccountPreferences(session.userId, response.preferences);
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
