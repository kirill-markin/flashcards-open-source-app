import type { ReactElement } from "react";
import { useI18n } from "../../i18n";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function ServerSettingsInfoScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("settingsHome.server.title")}
      subtitle={t("settingsHome.server.description")}
      activeTab="general"
    >
      <SettingsGroup>
        <article className="content-card settings-summary-card" role="note">
          <strong className="panel-subtitle">{t("settingsHome.server.title")}</strong>
          <p className="subtitle">{t("settingsHome.server.description")}</p>
        </article>
      </SettingsGroup>
    </SettingsShell>
  );
}
