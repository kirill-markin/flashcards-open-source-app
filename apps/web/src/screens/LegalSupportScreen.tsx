import type { ReactElement } from "react";
import { SettingsShell } from "./SettingsShared";

const privacyPolicyUrl: string = "https://flashcards-open-source-app.com/privacy/";
const termsOfServiceUrl: string = "https://flashcards-open-source-app.com/terms/";
const supportUrl: string = "https://flashcards-open-source-app.com/support/";
const supportEmailAddress: string = "kirill+flashcards@kirill-markin.com";
const supportEmailUrl: string = `mailto:${supportEmailAddress}`;

export function LegalSupportScreen(): ReactElement {
  return (
    <SettingsShell
      title="Legal & Support"
      subtitle="Review policy links and support contact details for the hosted app."
      activeTab="account"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Privacy Policy</span>
          <a className="ghost-btn" href={privacyPolicyUrl} rel="noreferrer" target="_blank">
            Open policy
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Terms of Service</span>
          <a className="ghost-btn" href={termsOfServiceUrl} rel="noreferrer" target="_blank">
            Open terms
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Support</span>
          <a className="ghost-btn" href={supportUrl} rel="noreferrer" target="_blank">
            Open support
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Support Email</span>
          <a className="ghost-btn" href={supportEmailUrl}>
            {supportEmailAddress}
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Hosted app help</span>
          <p className="subtitle">
            Use the support page for hosted app questions, account deletion help, and billing or access follow-up.
          </p>
        </article>
      </div>
    </SettingsShell>
  );
}
