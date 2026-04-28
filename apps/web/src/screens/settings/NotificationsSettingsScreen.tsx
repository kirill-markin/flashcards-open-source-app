import type { ReactElement } from "react";
import { useI18n } from "../../i18n";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function NotificationsSettingsScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("notificationsSettings.title")}
      subtitle={t("notificationsSettings.subtitle")}
      activeTab="workspace"
    >
      <SettingsGroup>
        <article className="content-card settings-summary-card" role="note">
          <strong className="panel-subtitle">{t("notificationsSettings.cardTitle")}</strong>
          <p className="subtitle">{t("notificationsSettings.paragraphOne")}</p>
          <p className="subtitle">{t("notificationsSettings.paragraphTwo")}</p>
          <p className="subtitle">{t("notificationsSettings.paragraphThree")}</p>
        </article>
      </SettingsGroup>
    </SettingsShell>
  );
}
