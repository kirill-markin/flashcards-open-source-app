import type { MouseEvent, ReactElement, ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { GuestAccountAttentionBadge } from "./account/guest/GuestAccountAttentionBadge";

type SettingsTab = "general" | "current-workspace" | "workspace" | "account" | "device" | "access" | "test";

type SettingsShellProps = Readonly<{
  title: string;
  subtitle: string | null;
  activeTab: SettingsTab;
  children: ReactNode;
  panelClassName?: string;
  backLink?: SettingsBackLinkProps;
}>;

type SettingsBackLinkProps = Readonly<{
  label: string;
  to: string;
  testId: string;
}>;

type SettingsNavigationState = Readonly<{
  parentPath: string;
}>;

type SettingsNavigationCardProps = Readonly<{
  title: string;
  description: string | null;
  value: string | null;
  to: string;
  parentPath?: string;
  testId?: string;
  guestAccountAttention?: boolean;
}>;

type SettingsActionCardProps = Readonly<{
  title: string;
  description: string;
  value: string | null;
  onClick: () => void;
  testId?: string;
  isMuted?: boolean;
  disabled?: boolean;
  workspaceManagementState?: "locked" | "ready";
}>;

type SettingsExternalLinkCardProps = Readonly<{
  title: string;
  description: string;
  href: string;
  testId: string;
  opensInNewTab: boolean;
}>;

type SettingsGroupProps = Readonly<{
  title?: string;
  children: ReactNode;
  testId?: string;
}>;

function SettingsBackLink({ label, to, testId }: SettingsBackLinkProps): ReactElement {
  const state: SettingsNavigationState | null = useLocation().state;
  const navigate = useNavigate();

  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    if (
      state?.parentPath !== to
      || event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    event.preventDefault();
    void navigate(-1);
  }

  return (
    <Link className="ghost-btn" to={to} replace onClick={handleClick} data-testid={testId}>
      {label}
    </Link>
  );
}

export function SettingsShell(props: SettingsShellProps): ReactElement {
  const { title, subtitle, activeTab, children, panelClassName, backLink } = props;
  const settingsPanelClassName = panelClassName === undefined
    ? "panel screen-panel settings-panel"
    : `panel screen-panel settings-panel ${panelClassName}`;

  return (
    <main className="container settings-page">
      <section className={settingsPanelClassName} data-active-tab={activeTab}>
        <div className="screen-head">
          <div>
            <h1 className="title">{title}</h1>
          </div>
          {backLink === undefined ? null : <SettingsBackLink {...backLink} />}
        </div>

        <div className="screen-body">
          {subtitle === null ? null : <p className="subtitle">{subtitle}</p>}
          {children}
        </div>
      </section>
    </main>
  );
}

export function SettingsNavigationCard(props: SettingsNavigationCardProps): ReactElement {
  const { title, description, value, to, parentPath, testId, guestAccountAttention } = props;
  const state: SettingsNavigationState | undefined = parentPath === undefined ? undefined : { parentPath };

  return (
    <Link className={`settings-nav-card content-card${description === null ? " settings-nav-card-inline" : ""}${guestAccountAttention ? " guest-account-attention-target" : ""}`} to={to} state={state} data-testid={testId}>
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{title}</strong>
        {description === null ? null : <p className="subtitle">{description}</p>}
      </div>
      {value === null ? null : <span className="badge">{value}</span>}
      {guestAccountAttention ? <GuestAccountAttentionBadge /> : null}
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
      {value === null ? null : <span className="badge">{value}</span>}
    </button>
  );
}

export function SettingsExternalLinkCard(props: SettingsExternalLinkCardProps): ReactElement {
  const { title, description, href, testId, opensInNewTab } = props;

  return (
    <a
      className="settings-nav-card content-card"
      href={href}
      target={opensInNewTab ? "_blank" : undefined}
      rel={opensInNewTab ? "noreferrer" : undefined}
      data-testid={testId}
    >
      <div className="settings-nav-card-copy">
        <strong className="panel-subtitle">{title}</strong>
        <p className="subtitle">{description}</p>
      </div>
    </a>
  );
}

export function SettingsGroup(props: SettingsGroupProps): ReactElement {
  const { title, children, testId } = props;

  return (
    <section className="settings-group" data-testid={testId}>
      {title === undefined ? null : <h2 className="panel-subtitle">{title}</h2>}
      {children}
    </section>
  );
}
