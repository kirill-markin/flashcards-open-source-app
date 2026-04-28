import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { SettingsShell } from "../SettingsShared";

const repositoryUrl: string = "https://github.com/kirill-markin/flashcards-open-source-app";

export function OpenSourceSettingsScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("openSourceSettings.title")}
      subtitle={t("openSourceSettings.subtitle")}
      activeTab="account"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("openSourceSettings.labels.stack")}</span>
          <p className="subtitle">{t("openSourceSettings.stackDescription")}</p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("openSourceSettings.labels.repository")}</span>
          <a className="ghost-btn" href={repositoryUrl} rel="noreferrer" target="_blank">
            {t("openSourceSettings.repositoryAction")}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("openSourceSettings.labels.selfHosting")}</span>
          <p className="subtitle">{t("openSourceSettings.selfHostingDescription")}</p>
        </article>
      </div>
    </SettingsShell>
  );
}
