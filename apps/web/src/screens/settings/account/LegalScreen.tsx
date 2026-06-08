import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { SettingsShell } from "../SettingsShared";

const privacyPolicyUrl: string = "https://flashcards-open-source-app.com/privacy/";
const termsOfServiceUrl: string = "https://flashcards-open-source-app.com/terms/";

export function LegalScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("legal.title")}
      subtitle={t("legal.subtitle")}
      activeTab="account"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("legal.labels.privacyPolicy")}</span>
          <a className="ghost-btn" href={privacyPolicyUrl} rel="noreferrer" target="_blank">
            {t("legal.actions.openPolicy")}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("legal.labels.termsOfService")}</span>
          <a className="ghost-btn" href={termsOfServiceUrl} rel="noreferrer" target="_blank">
            {t("legal.actions.openTerms")}
          </a>
        </article>
      </div>
    </SettingsShell>
  );
}
