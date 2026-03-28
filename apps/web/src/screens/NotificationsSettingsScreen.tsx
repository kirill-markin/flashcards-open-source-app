import type { ReactElement } from "react";
import { SettingsGroup, SettingsShell } from "./SettingsShared";

const disabledFieldsetStyle: Readonly<Record<string, string>> = {
  border: "none",
  margin: "0",
  padding: "0",
  display: "grid",
  gap: "16px",
};

const disabledLabelStyle: Readonly<Record<string, string>> = {
  display: "grid",
  gap: "6px",
};

export function NotificationsSettingsScreen(): ReactElement {
  return (
    <SettingsShell
      title="Notifications"
      subtitle="Review study reminder settings for this workspace on the current device. The web client shows the same settings surface, but reminder delivery stays mobile-only in v1."
      activeTab="workspace"
    >
      <SettingsGroup>
        <article className="content-card settings-summary-card" role="note">
          <strong className="panel-subtitle">This device only</strong>
          <p className="subtitle">
            Notification settings stay attached to this workspace, but they apply only to the current device. Review reminders send study cards only and never include marketing messages.
          </p>
        </article>
      </SettingsGroup>

      <SettingsGroup title="Permission">
        <article className="content-card settings-summary-card">
          <strong className="panel-subtitle">Status</strong>
          <p className="subtitle">Browser notifications are not enabled from the web client in v1.</p>
          <button className="primary-btn" type="button" disabled>
            Mobile only in v1
          </button>
        </article>
      </SettingsGroup>

      <SettingsGroup title="Review Reminders">
        <article className="content-card settings-summary-card">
          <fieldset aria-disabled="true" disabled style={disabledFieldsetStyle}>
            <label style={disabledLabelStyle}>
              <span className="panel-subtitle">Enable reminders</span>
              <input type="checkbox" />
            </label>

            <div style={disabledLabelStyle}>
              <span className="panel-subtitle">Reminder mode</span>
              <label>
                <input checked name="notification-mode" readOnly type="radio" />
                {" "}
                Daily reminder
              </label>
              <p className="subtitle">Example: send one card every day at 10:00 local time.</p>
              <label>
                <input name="notification-mode" readOnly type="radio" />
                {" "}
                Inactivity reminder
              </label>
              <p className="subtitle">Example: between 10:00 and 19:00, remind me after 2 hours away from the app, and keep reminding me on later days inside that window until I come back.</p>
            </div>

            <label style={disabledLabelStyle}>
              <span className="panel-subtitle">Time</span>
              <input readOnly type="time" value="10:00" />
            </label>

            <label style={disabledLabelStyle}>
              <span className="panel-subtitle">From</span>
              <input readOnly type="time" value="10:00" />
            </label>

            <label style={disabledLabelStyle}>
              <span className="panel-subtitle">To</span>
              <input readOnly type="time" value="19:00" />
            </label>

            <label style={disabledLabelStyle}>
              <span className="panel-subtitle">Remind me after</span>
              <input readOnly type="text" value="2 hours" />
            </label>
          </fieldset>
        </article>
      </SettingsGroup>
    </SettingsShell>
  );
}
