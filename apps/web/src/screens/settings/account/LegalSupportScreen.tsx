import type { ReactElement } from "react";
import { useI18n } from "../../../i18n";
import { SettingsShell } from "../SettingsShared";

const privacyPolicyUrl: string = "https://flashcards-open-source-app.com/privacy/";
const termsOfServiceUrl: string = "https://flashcards-open-source-app.com/terms/";
const supportUrl: string = "https://flashcards-open-source-app.com/support/";
const supportEmailAddress: string = "kirill+flashcards@kirill-markin.com";
const supportEmailUrl: string = `mailto:${supportEmailAddress}`;

export function LegalSupportScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("legalSupport.title")}
      subtitle={t("legalSupport.subtitle")}
      activeTab="account"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("legalSupport.labels.privacyPolicy")}</span>
          <a className="ghost-btn" href={privacyPolicyUrl} rel="noreferrer" target="_blank">
            {t("legalSupport.actions.openPolicy")}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("legalSupport.labels.termsOfService")}</span>
          <a className="ghost-btn" href={termsOfServiceUrl} rel="noreferrer" target="_blank">
            {t("legalSupport.actions.openTerms")}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("legalSupport.labels.support")}</span>
          <a className="ghost-btn" href={supportUrl} rel="noreferrer" target="_blank">
            {t("legalSupport.actions.openSupport")}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("legalSupport.labels.supportEmail")}</span>
          <a className="ghost-btn" href={supportEmailUrl}>
            {supportEmailAddress}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("legalSupport.labels.hostedAppHelp")}</span>
          <p className="subtitle">{t("legalSupport.hostedHelpDescription")}</p>
        </article>
      </div>
    </SettingsShell>
  );
}
