import type { ReactElement } from "react";
import { SettingsShell } from "./SettingsShared";

export function ThisDeviceSettingsScreen(): ReactElement {
  return (
    <SettingsShell
      title="This Device"
      subtitle="Review browser-local behavior for this workspace on this device."
      activeSection="workspace"
    >
      <div className="settings-nav-list">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Client</span>
          <strong className="panel-subtitle">Browser + IndexedDB</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Local data</span>
          <p className="subtitle">No login is required to create cards, save decks, or review in the browser.</p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Workspace scope</span>
          <p className="subtitle">Future sync stays scoped to the currently selected workspace on this device.</p>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Storage</span>
          <p className="subtitle">The local cache keeps cards, decks, scheduler settings, and pending sync operations on this device.</p>
        </article>
      </div>
    </SettingsShell>
  );
}
