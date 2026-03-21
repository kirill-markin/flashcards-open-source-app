import type { ReactElement, ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { accountSettingsRoute, workspaceSettingsRoute } from "../routes";

type SettingsSection = "workspace" | "account";

type SettingsShellProps = Readonly<{
  title: string;
  subtitle: string;
  activeSection: SettingsSection | null;
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
}>;

type SettingsGroupProps = Readonly<{
  title?: string;
  children: ReactNode;
}>;

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { title, subtitle, activeSection, children } = props;

  return (
    <main className="container settings-page">
      <section className="panel settings-panel">
        {activeSection !== null ? (
          <nav className="settings-switcher" aria-label="Settings sections">
            <NavLink
              className={({ isActive }) => `settings-switcher-link${isActive ? " settings-switcher-link-active" : ""}`}
              to={workspaceSettingsRoute}
            >
              Workspace
            </NavLink>
            <NavLink
              className={({ isActive }) => `settings-switcher-link${isActive ? " settings-switcher-link-active" : ""}`}
              to={accountSettingsRoute}
            >
              Account
            </NavLink>
          </nav>
        ) : null}

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
  const { title, description, value, onClick, isMuted } = props;

  return (
    <button
      className={`settings-nav-card settings-nav-card-button content-card${isMuted ? " settings-nav-card-muted" : ""}`}
      type="button"
      onClick={onClick}
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
