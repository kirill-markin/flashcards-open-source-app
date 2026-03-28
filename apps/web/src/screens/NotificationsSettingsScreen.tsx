import type { ReactElement } from "react";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

export function NotificationsSettingsScreen(): ReactElement {
  return (
    <SettingsShell
      title="Notifications"
      subtitle="Notification preferences stay attached to this workspace, but reminders are configured only on the device where you want to receive them."
      activeTab="workspace"
    >
      <SettingsGroup>
        <article className="content-card settings-summary-card" role="note">
          <strong className="panel-subtitle">Set up notifications on iPhone or Android</strong>
          <p className="subtitle">
            Review reminder settings belong to this workspace, but they are turned on and managed separately on each device.
          </p>
          <p className="subtitle">
            If you want study notifications, open this workspace on the iPhone or Android device where you want to receive them and configure notifications there.
          </p>
          <p className="subtitle">
            The web app does not support notifications, so there are no notification controls on this screen.
          </p>
        </article>
      </SettingsGroup>
    </SettingsShell>
  );
}
