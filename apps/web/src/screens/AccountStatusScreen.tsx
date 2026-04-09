import type { ReactElement } from "react";
import { buildLogoutUrl } from "../api";
import { useAppData } from "../appData";
import { useI18n } from "../i18n";
import { SettingsShell } from "./SettingsShared";

function formatCloudStateTitle(cloudState: string | null, t: (key: "accountStatus.states.linked" | "accountStatus.states.linkingReady" | "accountStatus.states.disconnected") => string): string {
  if (cloudState === "linked") {
    return t("accountStatus.states.linked");
  }

  if (cloudState === "linking-ready") {
    return t("accountStatus.states.linkingReady");
  }

  return t("accountStatus.states.disconnected");
}

export function AccountStatusScreen(): ReactElement {
  const { cloudSettings, session } = useAppData();
  const { t, formatDateTime } = useI18n();
  const unavailableLabel = t("common.unavailable");

  return (
    <SettingsShell
      title={t("accountStatus.title")}
      subtitle={t("accountStatus.subtitle")}
      activeTab="account"
    >
      <div className="settings-detail-grid">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.email")}</span>
          <strong className="panel-subtitle">{cloudSettings?.linkedEmail ?? session?.profile.email ?? unavailableLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.accountState")}</span>
          <strong className="panel-subtitle">{formatCloudStateTitle(cloudSettings?.cloudState ?? null, t)}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.authTransport")}</span>
          <strong className="panel-subtitle">{session?.authTransport ?? unavailableLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.workspaceLink")}</span>
          <strong className="panel-subtitle">{cloudSettings?.linkedWorkspaceId ?? unavailableLabel}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.updated")}</span>
          <strong className="panel-subtitle txn-cell-mono">
            {cloudSettings?.updatedAt === undefined || cloudSettings.updatedAt === null ? unavailableLabel : formatDateTime(cloudSettings.updatedAt)}
          </strong>
        </article>
      </div>

      <div className="screen-actions">
        <a className="ghost-btn" href={buildLogoutUrl()}>
          {t("accountStatus.logout")}
        </a>
      </div>
    </SettingsShell>
  );
}
