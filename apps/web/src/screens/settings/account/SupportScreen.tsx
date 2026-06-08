import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { SettingsShell } from "../SettingsShared";

const supportUrl: string = "https://flashcards-open-source-app.com/support/";
const supportEmailAddress: string = "kirill+flashcards@kirill-markin.com";
const supportEmailUrl: string = `mailto:${supportEmailAddress}`;

export function SupportScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("support.title")}
      subtitle={t("support.subtitle")}
      activeTab="account"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("support.labels.supportPage")}</span>
          <a className="ghost-btn" href={supportUrl} rel="noreferrer" target="_blank">
            {t("support.actions.openSupport")}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("support.labels.supportEmail")}</span>
          <a className="ghost-btn" href={supportEmailUrl}>
            {supportEmailAddress}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("support.labels.hostedAppHelp")}</span>
          <p className="subtitle">{t("support.hostedHelpDescription")}</p>
        </article>
      </div>
    </SettingsShell>
  );
}
