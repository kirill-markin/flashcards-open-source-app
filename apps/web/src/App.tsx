import { useEffect, useRef, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { AccountMenu } from "./AccountMenu";
import { AppDataProvider, useAppData } from "./appData";
import { buildLogoutUrl } from "./api";
import { ChatPanel } from "./chat/ChatPanel";
import { ChatLayoutProvider, useChatLayout } from "./chat/ChatLayoutContext";
import { ChatToggle } from "./chat/ChatToggle";
import {
  accountSettingsRoute,
  buildSettingsDeckDetailRoute,
  buildSettingsDeckEditRoute,
  cardsRoute,
  chatRoute,
  reviewRoute,
  settingsDeckNewRoute,
  settingsDecksRoute,
  settingsTagsRoute,
  workspaceSettingsRoute,
} from "./routes";
import { AccountSettingsScreen } from "./screens/AccountSettingsScreen";
import { CardFormScreen } from "./screens/CardFormScreen";
import { CardsScreen } from "./screens/CardsScreen";
import { DeckDetailScreen } from "./screens/DeckDetailScreen";
import { DeckFormScreen } from "./screens/DeckFormScreen";
import { DecksScreen } from "./screens/DecksScreen";
import { ReviewScreen } from "./screens/ReviewScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TagsScreen } from "./screens/TagsScreen";

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

  if (sessionLoadState === "loading" || sessionLoadState === "redirecting") {
    return (
      <main className="page-state">
        <section className="panel panel-center state-panel">
          <p className="subtitle">{sessionLoadState === "redirecting" ? "Redirecting to login…" : "Loading…"}</p>
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
                currentWorkspaceName={activeWorkspace?.name ?? "Workspace"}
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
          <Route path={workspaceSettingsRoute} element={<SettingsScreen />} />
          <Route path={settingsDecksRoute} element={<DecksScreen />} />
          <Route path={settingsDeckNewRoute} element={<DeckFormScreen />} />
          <Route path={`${settingsDecksRoute}/:deckId/edit`} element={<DeckFormScreen />} />
          <Route path={`${settingsDecksRoute}/:deckId`} element={<DeckDetailScreen />} />
          <Route path={settingsTagsRoute} element={<TagsScreen />} />
          <Route path={accountSettingsRoute} element={<AccountSettingsScreen />} />
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
