import { GuestSignIn } from "./guest/GuestSignIn";
import { AccountMethods } from "./AccountMethods";
import { type ReactElement } from "react";
import {
  buildLogoutUrl,
} from "../../../api";
import { useAppData } from "../../../appData";
import { useI18n } from "../../../i18n";
import { SignOutLink } from "../../../SignOutLink";
import { SettingsShell } from "../SettingsShared";

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
  if (session?.browserGuestCapabilities?.isGuest === true) return <SettingsShell title={t("guest.title")} subtitle={t("guest.warning")} activeTab="account">
    <section className="content-card"><h2 className="panel-subtitle">{t("guest.saveProgress")}</h2>
      <p>{t("guest.mergeExplanation")}</p><GuestSignIn label={t("guest.signIn")} testId="account-guest-sign-in" guestAccountAttention />
    </section>
  </SettingsShell>;
  const unavailableLabel = t("common.unavailable");
  const accountEmail: string | null = cloudSettings?.linkedEmail ?? session?.profile.email ?? null;
  const accountEmailLabel: string = accountEmail ?? unavailableLabel;

  return (
    <SettingsShell
      title={t("accountStatus.title")}
      subtitle={t("accountStatus.subtitle")}
      activeTab="account"
    >
      <div className="settings-detail-grid">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">{t("accountStatus.labels.email")}</span>
          <span data-testid="account-status-email-value" hidden>{accountEmail ?? ""}</span>
          <strong
            className="panel-subtitle"
            data-testid="account-status-email"
            data-email={accountEmail ?? ""}
          >
            {accountEmailLabel}
          </strong>
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

      <AccountMethods />
      <div className="screen-actions">
        <SignOutLink
          className="ghost-btn"
          href={buildLogoutUrl()}
          label={t("accountStatus.logout")}
        />
      </div>
    </SettingsShell>
  );
}
