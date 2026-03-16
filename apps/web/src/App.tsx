import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AccountMenu } from "./AccountMenu";
import {
  clearAllLocalBrowserData,
  deleteAccountConfirmationText,
  isAccountDeletionPending,
  loadAccountDeletionCsrfToken,
  subscribeToAccountDeletionPending,
} from "./accountDeletion";
import { AppDataProvider, useAppData } from "./appData";
import { ApiError, buildLoginUrl, buildLogoutLocalUrl, buildLogoutUrl, deleteMyAccount, primeSessionCsrfToken } from "./api";
import { ChatPanel } from "./chat/ChatPanel";
import { ChatLayoutProvider, useChatLayout } from "./chat/ChatLayoutContext";
import { ChatToggle } from "./chat/ChatToggle";
import {
  accountAgentConnectionsRoute,
  accountDangerZoneRoute,
  accountOpenSourceRoute,
  accountSettingsRoute,
  accountStatusRoute,
  buildSettingsDeckDetailRoute,
  buildSettingsDeckEditRoute,
  cardsRoute,
  chatRoute,
  reviewRoute,
  settingsAccessRoute,
  settingsAccessDetailRoutePattern,
  settingsDeckNewRoute,
  settingsDecksRoute,
  settingsDeviceRoute,
  settingsExportRoute,
  settingsHubRoute,
  settingsOverviewRoute,
  settingsSchedulerRoute,
  settingsTagsRoute,
  workspaceSettingsRoute,
} from "./routes";
import { AccessPermissionDetailScreen } from "./screens/AccessPermissionDetailScreen";
import { AccessSettingsScreen } from "./screens/AccessSettingsScreen";
import { AccountStatusScreen } from "./screens/AccountStatusScreen";
import { AccountSettingsScreen } from "./screens/AccountSettingsScreen";
import { AgentConnectionsScreen } from "./screens/AgentConnectionsScreen";
import { CardFormScreen } from "./screens/CardFormScreen";
import { CardsScreen } from "./screens/CardsScreen";
import { DeckDetailScreen } from "./screens/DeckDetailScreen";
import { DeckFormScreen } from "./screens/DeckFormScreen";
import { DecksScreen } from "./screens/DecksScreen";
import { DangerZoneScreen } from "./screens/DangerZoneScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { OpenSourceSettingsScreen } from "./screens/OpenSourceSettingsScreen";
import { ThisDeviceSettingsScreen } from "./screens/ThisDeviceSettingsScreen";
import { TagsScreen } from "./screens/TagsScreen";
import { WorkspaceOverviewScreen } from "./screens/WorkspaceOverviewScreen";
import { WorkspaceSchedulerScreen } from "./screens/WorkspaceSchedulerScreen";
import { WorkspaceExportScreen } from "./screens/WorkspaceExportScreen";
import { WorkspaceSettingsScreen } from "./screens/WorkspaceSettingsScreen";

function LegacyDeckDetailRedirect(): ReactElement {
  const { deckId } = useParams();

  if (deckId === undefined || deckId === "") {
    throw new Error("Legacy deck redirect is missing deckId");
  }

  return <Navigate replace to={buildSettingsDeckDetailRoute(deckId)} />;
}

function LegacyDeckEditRedirect(): ReactElement {
  const { deckId } = useParams();

  if (deckId === undefined || deckId === "") {
    throw new Error("Legacy deck edit redirect is missing deckId");
  }

  return <Navigate replace to={buildSettingsDeckEditRoute(deckId)} />;
}

export function AppShell(): ReactElement {
  const {
    sessionLoadState,
    sessionErrorMessage,
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
    errorMessage,
    initialize,
    chooseWorkspace,
    createWorkspace,
  } = useAppData();
  const [isAccountDeletionPendingState, setIsAccountDeletionPendingState] = useState<boolean>(isAccountDeletionPending);
  const [accountDeletionErrorMessage, setAccountDeletionErrorMessage] = useState<string>("");
  const [isAccountDeletionSubmitting, setIsAccountDeletionSubmitting] = useState<boolean>(false);

  const completeAccountDeletion = useCallback(async function completeAccountDeletion(): Promise<void> {
    setIsAccountDeletionSubmitting(true);
    setAccountDeletionErrorMessage("");

    try {
      const persistedCsrfToken = loadAccountDeletionCsrfToken();
      if (persistedCsrfToken !== null) {
        primeSessionCsrfToken(persistedCsrfToken);
      }
      await deleteMyAccount(deleteAccountConfirmationText);
      await clearAllLocalBrowserData();
      window.location.href = buildLogoutLocalUrl();
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACCOUNT_DELETED") {
        await clearAllLocalBrowserData();
        window.location.href = buildLogoutLocalUrl();
        return;
      }

      setAccountDeletionErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAccountDeletionSubmitting(false);
    }
  }, []);

  useEffect(() => subscribeToAccountDeletionPending(() => {
    setIsAccountDeletionPendingState(isAccountDeletionPending());
  }), []);

  useEffect(() => {
    if (isAccountDeletionPendingState && !isAccountDeletionSubmitting && accountDeletionErrorMessage === "") {
      void completeAccountDeletion();
    }
  }, [accountDeletionErrorMessage, completeAccountDeletion, isAccountDeletionPendingState, isAccountDeletionSubmitting]);

  if (isAccountDeletionPendingState) {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">Deleting account</h1>
          <p className="subtitle">
            Your account deletion is in progress. Do not close this page unless you plan to come back and retry.
          </p>
          {accountDeletionErrorMessage !== "" ? <p className="error-banner">{accountDeletionErrorMessage}</p> : null}
          <button
            className="primary-btn"
            type="button"
            disabled={isAccountDeletionSubmitting}
            onClick={() => void completeAccountDeletion()}
          >
            {isAccountDeletionSubmitting ? "Deleting..." : "Retry deletion"}
          </button>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "loading" || sessionLoadState === "redirecting") {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <p className="subtitle">{sessionLoadState === "redirecting" ? "Redirecting to login…" : "Loading…"}</p>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "loading_workspace" && activeWorkspace !== null) {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">{activeWorkspace.name}</h1>
          <p className="subtitle">{sessionErrorMessage === "" ? "Loading workspace…" : sessionErrorMessage}</p>
          {sessionErrorMessage !== "" ? (
            <button className="primary-btn" type="button" onClick={() => void chooseWorkspace(activeWorkspace.workspaceId)}>
              Retry
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  if (sessionLoadState === "error") {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">Flashcards</h1>
          <p className="error-banner">{sessionErrorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void initialize()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "deleted") {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <h1 className="title">Flashcards</h1>
          <p className="subtitle">{sessionErrorMessage}</p>
          <a className="primary-btn" href={buildLoginUrl(window.location.origin)}>
            Sign in again
          </a>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "selecting_workspace") {
    return (
      <main className="page-state">
        <section className="panel panel-center workspace-modal state-panel">
          <h1 className="title">Choose workspace</h1>
          <p className="subtitle">
            Select which existing workspace should receive the local browser data from this device.
          </p>
          <div className="workspace-choice-list">
            {availableWorkspaces.map((workspace) => (
              <button
                key={workspace.workspaceId}
                className="ghost-btn workspace-choice-btn"
                type="button"
                onClick={() => void chooseWorkspace(workspace.workspaceId)}
                disabled={isChoosingWorkspace}
              >
                <span className="workspace-choice-name">{workspace.name}</span>
                <span className="workspace-choice-meta">{workspace.createdAt}</span>
              </button>
            ))}
          </div>
          {errorMessage !== "" ? <p className="error-banner">{errorMessage}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <div className="header-sticky">
        <header className="topbar-shell">
          <div className="topbar">
            <div className="topbar-brand-block">
              <a className="topbar-brand" href={reviewRoute}>
                <span className="brand-full">flashcards-open-source-app</span>
                <span className="brand-short">flashcards</span>
              </a>
              <p className="topbar-workspace">{activeWorkspace?.name ?? "Workspace unavailable"}</p>
            </div>
            <nav className="nav" aria-label="Primary">
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={reviewRoute}>
                Review
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={cardsRoute}>
                Cards
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={chatRoute}>
                AI chat
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to={workspaceSettingsRoute}>
                Settings
              </NavLink>
            </nav>
            <div className="topbar-actions">
              <AccountMenu
                workspaces={availableWorkspaces}
                currentWorkspaceId={activeWorkspace?.workspaceId ?? ""}
                isBusy={isChoosingWorkspace}
                accountSettingsUrl={accountSettingsRoute}
                logoutUrl={buildLogoutUrl()}
                onSelectWorkspace={chooseWorkspace}
                onCreateWorkspace={createWorkspace}
              />
            </div>
          </div>
        </header>
      </div>
      {errorMessage !== "" ? (
        <div className="global-error-wrap">
          <div className="global-error">{errorMessage}</div>
        </div>
      ) : null}
      <RoutedShell />
    </div>
  );
}

function buildChatLayoutShellClassName(isFullscreenChat: boolean, isOpen: boolean): string {
  const sidebarStateClassName = !isFullscreenChat && isOpen
    ? "chat-layout-shell-sidebar-open"
    : "chat-layout-shell-sidebar-closed";

  return isFullscreenChat
    ? `chat-layout-shell ${sidebarStateClassName} chat-layout-shell-fullscreen`
    : `chat-layout-shell ${sidebarStateClassName}`;
}

function buildChatMainContentClassName(isFullscreenChat: boolean, isOpen: boolean): string {
  const sidebarStateClassName = !isFullscreenChat && isOpen
    ? "chat-main-content-sidebar-open"
    : "chat-main-content-sidebar-closed";

  return isFullscreenChat
    ? `chat-main-content ${sidebarStateClassName} chat-main-content-fullscreen`
    : `chat-main-content ${sidebarStateClassName}`;
}

export function RoutedShell(): ReactElement {
  const location = useLocation();
  const { isOpen } = useChatLayout();
  const isFullscreenChat = location.pathname === "/chat";
  const contentRef = useRef<HTMLDivElement | null>(null);
  const shellClassName = buildChatLayoutShellClassName(isFullscreenChat, isOpen);
  const contentClassName = buildChatMainContentClassName(isFullscreenChat, isOpen);

  useEffect(() => {
    if (contentRef.current !== null) {
      contentRef.current.scrollTop = 0;
      contentRef.current.scrollLeft = 0;
    }
  }, [location.pathname]);

  return (
    <div className={shellClassName}>
      {!isFullscreenChat && isOpen ? <ChatPanel mode="sidebar" /> : null}
      <div ref={contentRef} className={contentClassName}>
        <Routes>
          <Route path="/" element={<Navigate replace to={reviewRoute} />} />
          <Route path={cardsRoute} element={<CardsScreen />} />
          <Route path={`${cardsRoute}/new`} element={<CardFormScreen />} />
          <Route path={`${cardsRoute}/:cardId`} element={<CardFormScreen />} />
          <Route path="/decks" element={<Navigate replace to={settingsDecksRoute} />} />
          <Route path="/decks/new" element={<Navigate replace to={settingsDeckNewRoute} />} />
          <Route path="/decks/:deckId/edit" element={<LegacyDeckEditRedirect />} />
          <Route path="/decks/:deckId" element={<LegacyDeckDetailRedirect />} />
          <Route path="/tags" element={<Navigate replace to={settingsTagsRoute} />} />
          <Route path={reviewRoute} element={<ReviewScreen />} />
          <Route path={settingsHubRoute} element={<SettingsScreen />} />
          <Route path={settingsAccessRoute} element={<AccessSettingsScreen />} />
          <Route path={settingsAccessDetailRoutePattern} element={<AccessPermissionDetailScreen />} />
          <Route path={workspaceSettingsRoute} element={<WorkspaceSettingsScreen />} />
          <Route path={settingsOverviewRoute} element={<WorkspaceOverviewScreen />} />
          <Route path={settingsSchedulerRoute} element={<WorkspaceSchedulerScreen />} />
          <Route path={settingsExportRoute} element={<WorkspaceExportScreen />} />
          <Route path={settingsDecksRoute} element={<DecksScreen />} />
          <Route path={settingsDeckNewRoute} element={<DeckFormScreen />} />
          <Route path={`${settingsDecksRoute}/:deckId/edit`} element={<DeckFormScreen />} />
          <Route path={`${settingsDecksRoute}/:deckId`} element={<DeckDetailScreen />} />
          <Route path={settingsTagsRoute} element={<TagsScreen />} />
          <Route path={settingsDeviceRoute} element={<ThisDeviceSettingsScreen />} />
          <Route path={accountSettingsRoute} element={<AccountSettingsScreen />} />
          <Route path={accountStatusRoute} element={<AccountStatusScreen />} />
          <Route path={accountOpenSourceRoute} element={<OpenSourceSettingsScreen />} />
          <Route path={accountAgentConnectionsRoute} element={<AgentConnectionsScreen />} />
          <Route path={accountDangerZoneRoute} element={<DangerZoneScreen />} />
          <Route
            path={chatRoute}
            element={
              <main className="container chat-page">
                <ChatPanel mode="fullscreen" />
              </main>
            }
          />
        </Routes>
      </div>
      {!isFullscreenChat && !isOpen ? <ChatToggle /> : null}
    </div>
  );
}

export default function App(): ReactElement {
  return (
    <AppDataProvider>
      <ChatLayoutProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </ChatLayoutProvider>
    </AppDataProvider>
  );
}
