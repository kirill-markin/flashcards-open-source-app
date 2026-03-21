import type { ReactElement } from "react";
import { SettingsShell } from "./SettingsShared";

const repositoryUrl: string = "https://github.com/kirill-markin/flashcards-open-source-app";

export function OpenSourceSettingsScreen(): ReactElement {
  return (
    <SettingsShell
      title="Open Source"
      subtitle="Review the repository, license, and self-hosting references for the app stack."
      activeTab="account"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Open-source stack</span>
          <p className="subtitle">
            The iOS app and the backend are fully open source. You can inspect the code, use the MIT license, and run the same stack on your own servers.
          </p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">GitHub Repository (MIT License)</span>
          <a className="ghost-btn" href={repositoryUrl} rel="noreferrer" target="_blank">
            Open repository
          </a>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Self-hosting</span>
          <p className="subtitle">
            If you need your own backend, deploy the same open-source stack on your infrastructure and use your own web and iOS clients with that deployment.
          </p>
        </article>
      </div>
    </SettingsShell>
  );
}
