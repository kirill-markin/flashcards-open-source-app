import { useEffect, useRef, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AccountMenu } from "./AccountMenu";
import { AppDataProvider, useAppData } from "./appData";
import { buildLogoutUrl } from "./api";
import { ChatPanel } from "./chat/ChatPanel";
import { ChatLayoutProvider, useChatLayout } from "./chat/ChatLayoutContext";
import { ChatToggle } from "./chat/ChatToggle";
import { CardFormScreen } from "./screens/CardFormScreen";
import { CardsScreen } from "./screens/CardsScreen";
import { DeckFormScreen } from "./screens/DeckFormScreen";
import { DecksScreen } from "./screens/DecksScreen";
import { ReviewScreen } from "./screens/ReviewScreen";

function AppShell(): ReactElement {
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
              <a className="topbar-brand" href="/cards">
                <span className="brand-full">flashcards-open-source-app</span>
                <span className="brand-short">flashcards</span>
              </a>
              <p className="topbar-workspace">{activeWorkspace?.name ?? "Workspace unavailable"}</p>
            </div>
            <nav className="nav" aria-label="Primary">
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to="/cards">
                Cards
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to="/decks">
                Decks
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to="/review">
                Review
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to="/chat">
                AI chat
              </NavLink>
            </nav>
            <div className="topbar-actions">
              <AccountMenu
                workspaces={availableWorkspaces}
                currentWorkspaceId={activeWorkspace?.workspaceId ?? ""}
                currentWorkspaceName={activeWorkspace?.name ?? "Workspace"}
                isBusy={isChoosingWorkspace}
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

function RoutedShell(): ReactElement {
  const location = useLocation();
  const { isOpen } = useChatLayout();
  const isFullscreenChat = location.pathname === "/chat";
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (contentRef.current !== null) {
      contentRef.current.scrollTop = 0;
      contentRef.current.scrollLeft = 0;
    }
  }, [location.pathname]);

  return (
    <div className="chat-layout-shell">
      {!isFullscreenChat && isOpen ? <ChatPanel mode="sidebar" /> : null}
      <div ref={contentRef} className="chat-main-content">
        <Routes>
          <Route path="/" element={<Navigate replace to="/cards" />} />
          <Route path="/cards" element={<CardsScreen />} />
          <Route path="/cards/new" element={<CardFormScreen />} />
          <Route path="/cards/:cardId" element={<CardFormScreen />} />
          <Route path="/decks" element={<DecksScreen />} />
          <Route path="/decks/new" element={<DeckFormScreen />} />
          <Route path="/review" element={<ReviewScreen />} />
          <Route
            path="/chat"
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
