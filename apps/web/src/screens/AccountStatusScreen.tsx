import type { ReactElement } from "react";
import { buildLogoutUrl } from "../api";
import { useAppData } from "../appData";
import { SettingsShell } from "./SettingsShared";

function formatCloudStateTitle(cloudState: string | null): string {
  if (cloudState === "linked") {
    return "Linked";
  }

  if (cloudState === "linking-ready") {
    return "Linking ready";
  }

  return "Disconnected";
}

export function AccountStatusScreen(): ReactElement {
  const { getLocalSnapshot, session } = useAppData();
  const cloudSettings = getLocalSnapshot().cloudSettings;

  return (
    <SettingsShell
      title="Account Status"
      subtitle="Review the current signed-in account and browser session."
      activeSection="account"
    >
      <div className="settings-detail-grid">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Email</span>
          <strong className="panel-subtitle">{cloudSettings?.linkedEmail ?? session?.profile.email ?? "Unavailable"}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Account state</span>
          <strong className="panel-subtitle">{formatCloudStateTitle(cloudSettings?.cloudState ?? null)}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Auth transport</span>
          <strong className="panel-subtitle">{session?.authTransport ?? "Unavailable"}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Workspace link</span>
          <strong className="panel-subtitle">{cloudSettings?.linkedWorkspaceId ?? "Unavailable"}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Updated</span>
          <strong className="panel-subtitle txn-cell-mono">{cloudSettings?.updatedAt ?? "Unavailable"}</strong>
        </article>
      </div>

      <div className="screen-actions">
        <a className="ghost-btn" href={buildLogoutUrl()}>
          Logout
        </a>
      </div>
    </SettingsShell>
  );
}
