import { useEffect, useRef, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
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
    session,
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
    errorMessage,
    initialize,
    chooseWorkspace,
  } = useAppData();

  if (sessionLoadState === "loading" || sessionLoadState === "redirecting") {
    return (
      <main className="page-state">
        <section className="panel panel-center">
          <p className="subtitle">{sessionLoadState === "redirecting" ? "Redirecting to login…" : "Loading…"}</p>
        </section>
      </main>
    );
  }

  if (sessionLoadState === "error") {
    return (
      <main className="page-state">
        <section className="panel panel-center">
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
        <section className="panel panel-center workspace-modal">
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
    <>
      <div className="header-sticky">
        <header className="topbar">
          <a className="topbar-brand" href="/cards">
            flashcards-open-source-app
          </a>
          <div className="topbar-actions">
            {activeWorkspace !== null ? <span className="badge">{activeWorkspace.name}</span> : null}
            <span className="topbar-account">{session?.profile.email ?? session?.userId ?? "Account"}</span>
            <a className="ghost-btn topbar-signout" href={buildLogoutUrl()}>
              Sign out
            </a>
          </div>
        </header>
        <nav className="nav">
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
      </div>
      {errorMessage !== "" ? <div className="global-error">{errorMessage}</div> : null}
      <RoutedShell />
    </>
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
