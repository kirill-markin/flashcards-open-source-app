import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

type SettingsTab = "general" | "current-workspace" | "workspace" | "account" | "device" | "access" | "test";

type SettingsShellProps = Readonly<{
  title: string;
  subtitle: string;
  activeTab: SettingsTab;
  children: ReactNode;
  panelClassName?: string;
}>;

type SettingsNavigationCardProps = Readonly<{
  title: string;
  description: string;
  value: string;
  to: string;
  testId?: string;
}>;

type SettingsActionCardProps = Readonly<{
  title: string;
  description: string;
  value: string;
  onClick: () => void;
  testId?: string;
  isMuted?: boolean;
  disabled?: boolean;
  workspaceManagementState?: "locked" | "ready";
}>;

type SettingsGroupProps = Readonly<{
  title?: string;
  children: ReactNode;
}>;

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { title, subtitle, activeTab, children, panelClassName } = props;
  const settingsPanelClassName = panelClassName === undefined
    ? "panel settings-panel"
    : `panel settings-panel ${panelClassName}`;

  return (
    <main className="container settings-page">
      <section className={settingsPanelClassName} data-active-tab={activeTab}>
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
  const { title, description, value, to, testId } = props;

  return (
    <Link className="settings-nav-card content-card" to={to} data-testid={testId}>
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{title}</strong>
        <p className="subtitle">{description}</p>
      </div>
      <span className="badge">{value}</span>
    </Link>
  );
}

export function SettingsActionCard(props: SettingsActionCardProps): ReactElement {
  const { title, description, value, onClick, testId, isMuted, disabled, workspaceManagementState } = props;

  return (
    <button
      className={`settings-nav-card settings-nav-card-button content-card${isMuted ? " settings-nav-card-muted" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={workspaceManagementState === undefined ? undefined : workspaceManagementState === "locked" ? "true" : "false"}
      data-workspace-management-state={workspaceManagementState}
      data-testid={testId}
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
