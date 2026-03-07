import { useEffect, useRef, type ReactElement } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppDataProvider, useAppData } from "./appData";
import { ChatPanel } from "./chat/ChatPanel";
import { ChatLayoutProvider, useChatLayout } from "./chat/ChatLayoutContext";
import { ChatToggle } from "./chat/ChatToggle";
import { CardFormScreen } from "./screens/CardFormScreen";
import { CardsScreen } from "./screens/CardsScreen";
import { DeckFormScreen } from "./screens/DeckFormScreen";
import { DecksScreen } from "./screens/DecksScreen";
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
      <div className="header-sticky">
        <header className="topbar">
          <a className="topbar-brand" href="/cards">
            flashcards-open-source-app
          </a>
          <div className="topbar-actions">
            <button
              type="button"
              className="account-button"
              aria-label="Account"
              title={session?.profile.email ?? session?.userId ?? "Account"}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M20 21a8 8 0 0 0-16 0" />
              </svg>
            </button>
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
