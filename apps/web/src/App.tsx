import type { ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppDataProvider, useAppData } from "./appData";
import { ChatPanel } from "./chat/ChatPanel";
import { ChatLayoutProvider, useChatLayout } from "./chat/ChatLayoutContext";
import { ChatToggle } from "./chat/ChatToggle";
import { CardFormScreen } from "./screens/CardFormScreen";
import { CardsScreen } from "./screens/CardsScreen";
import { ReviewScreen } from "./screens/ReviewScreen";

function AppShell(): ReactElement {
  const { loadState, session, errorMessage, initialize } = useAppData();

  if (loadState === "loading" || loadState === "redirecting") {
    return (
      <main className="page-state">
        <section className="panel panel-center">
          <p className="subtitle">{loadState === "redirecting" ? "Redirecting to login…" : "Loading…"}</p>
        </section>
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main className="page-state">
        <section className="panel panel-center">
          <h1 className="title">Flashcards</h1>
          <p className="error-banner">{errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void initialize()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      <header className="header-sticky">
        <div className="topbar">
          <div>
            <div className="topbar-brand">flashcards-open-source-app</div>
            <nav className="nav">
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to="/review">
                Review
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to="/cards">
                Cards
              </NavLink>
              <NavLink className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`} to="/chat">
                AI chat
              </NavLink>
            </nav>
          </div>
          <div className="topbar-session">
            <span className="badge">{session?.profile.email ?? session?.userId}</span>
            <span className="badge">workspace {session?.workspaceId}</span>
            <span className="badge">{session?.authTransport}</span>
          </div>
        </div>
      </header>
      {errorMessage !== "" ? <div className="global-error">{errorMessage}</div> : null}
      <RoutedShell />
    </>
  );
}

function RoutedShell(): ReactElement {
  const location = useLocation();
  const { isOpen } = useChatLayout();
  const isFullscreenChat = location.pathname === "/chat";

  return (
    <div className="chat-layout-shell">
      {!isFullscreenChat && isOpen ? <ChatPanel mode="sidebar" /> : null}
      <div className="chat-main-content">
        <Routes>
          <Route path="/" element={<Navigate replace to="/review" />} />
          <Route path="/review" element={<ReviewScreen />} />
          <Route path="/cards" element={<CardsScreen />} />
          <Route path="/cards/new" element={<CardFormScreen />} />
          <Route path="/cards/:cardId" element={<CardFormScreen />} />
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
