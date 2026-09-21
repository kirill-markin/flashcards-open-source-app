import { type ReactElement } from "react";
import { AnalyticsConsentToggleCard } from "../../analytics";
import { updateAccountPreferences } from "../../api";
import { useAppData } from "../../appData";
import { useI18n } from "../../i18n";
import type { AnalyticsConsentChoice } from "../../types";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

/**
 * Changing the analytics consent decision later, which is what makes the answer on the banner a
 * decision rather than a one-way door. It is the withdrawal control for a signed-in person; the same
 * switch is offered on the public catalog, invite and share routes by `PublicAnalyticsConsentLink`,
 * which reads its account owner from the analytics runtime because it has no app data to read.
 *
 * `/settings/analytics` is not among the paths `App.tsx` serves above `AuthenticatedApp`, so a
 * signed-out visitor opening it is redirected to the auth origin. That is why the public control is
 * a link rendering the switch in place rather than a second route onto this screen: a route declared
 * above `AuthenticatedApp` would win for everyone and take this screen away from the person it
 * already serves.
 *
 * The decision belongs to the browser first and is carried to the account whenever one is signed in,
 * so this screen writes both.
 */
export function AnalyticsSettingsScreen(): ReactElement {
  const { isSessionVerified, session, setAccountPreferences } = useAppData();
  const { t } = useI18n();

  async function persistAccountConsent(decision: AnalyticsConsentChoice): Promise<void> {
    if (session === null || isSessionVerified === false) {
      return;
    }

    // Only the field this screen owns is written, and the account copy follows the browser's own
    // decision rather than replacing it: the browser is where the measurement happens.
    const response = await updateAccountPreferences({ analyticsConsent: decision });
    setAccountPreferences(session.userId, response.preferences);
  }

  return (
    <SettingsShell
      title={t("analyticsSettings.title")}
      subtitle={t("analyticsSettings.subtitle")}
      activeTab="general"
    >
      <SettingsGroup>
        <AnalyticsConsentToggleCard persistAccountConsent={persistAccountConsent} />
      </SettingsGroup>
    </SettingsShell>
  );
}
