import type { ReactElement, ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import {
  accountSettingsRoute,
  settingsAccessRoute,
  settingsCurrentWorkspaceRoute,
  settingsDeviceRoute,
  settingsHubRoute,
  workspaceSettingsRoute,
} from "../routes";

type SettingsTab = "general" | "current-workspace" | "workspace" | "account" | "device" | "access";

type SettingsShellProps = Readonly<{
  title: string;
  subtitle: string;
  activeTab: SettingsTab;
  children: ReactNode;
}>;

type SettingsNavigationCardProps = Readonly<{
  title: string;
  description: string;
  value: string;
  to: string;
}>;

type SettingsActionCardProps = Readonly<{
  title: string;
  description: string;
  value: string;
  onClick: () => void;
  isMuted?: boolean;
  workspaceManagementState?: "locked" | "ready";
}>;

type SettingsGroupProps = Readonly<{
  title?: string;
  children: ReactNode;
}>;

type SettingsTabItem = Readonly<{
  key: SettingsTab;
  label: string;
  to: string;
  end?: boolean;
}>;

const settingsTabs: ReadonlyArray<SettingsTabItem> = [
  {
    key: "general",
    label: "General",
    to: settingsHubRoute,
    end: true,
  },
  {
    key: "current-workspace",
    label: "Current Workspace",
    to: settingsCurrentWorkspaceRoute,
    end: true,
  },
  {
    key: "workspace",
    label: "Workspace",
    to: workspaceSettingsRoute,
  },
  {
    key: "account",
    label: "Account",
    to: accountSettingsRoute,
  },
  {
    key: "device",
    label: "Device",
    to: settingsDeviceRoute,
    end: true,
  },
  {
    key: "access",
    label: "Access",
    to: settingsAccessRoute,
  },
] as const;

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { title, subtitle, activeTab, children } = props;

  return (
    <main className="container settings-page">
      <section className="panel settings-panel">
        <nav className="settings-switcher" aria-label="Settings tabs" data-active-tab={activeTab}>
          {settingsTabs.map((tab) => (
            <NavLink
              key={tab.key}
              className={({ isActive }) => `settings-switcher-link${isActive ? " settings-switcher-link-active" : ""}`}
              to={tab.to}
              end={tab.end}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="screen-head">
          <div>
            <h1 className="panel-subtitle">{title}</h1>
            <p className="subtitle">{subtitle}</p>
          </div>
        </div>

        {children}
      </section>
    </main>
  );
}

export function SettingsNavigationCard(props: SettingsNavigationCardProps): ReactElement {
  const { title, description, value, to } = props;

  return (
    <Link className="settings-nav-card content-card" to={to}>
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{title}</strong>
        <p className="subtitle">{description}</p>
      </div>
      <span className="badge">{value}</span>
    </Link>
  );
}

export function SettingsActionCard(props: SettingsActionCardProps): ReactElement {
  const { title, description, value, onClick, isMuted, workspaceManagementState } = props;

  return (
    <button
      className={`settings-nav-card settings-nav-card-button content-card${isMuted ? " settings-nav-card-muted" : ""}`}
      type="button"
      onClick={onClick}
      aria-disabled={workspaceManagementState === undefined ? undefined : workspaceManagementState === "locked" ? "true" : "false"}
      data-workspace-management-state={workspaceManagementState}
    >
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{title}</strong>
        <p className="subtitle">{description}</p>
      </div>
      <span className="badge">{value}</span>
    </button>
  );
}

export function SettingsGroup(props: SettingsGroupProps): ReactElement {
  const { title, children } = props;

  return (
    <section className="settings-group">
      {title === undefined ? null : <h2 className="panel-subtitle">{title}</h2>}
      {children}
    </section>
  );
}
