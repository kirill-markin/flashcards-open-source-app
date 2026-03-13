import { useEffect, type ReactElement } from "react";
import { makeWorkspaceTagsSummary } from "../appData/domain";
import { useAppData } from "../appData";
import { SettingsShell } from "./SettingsShared";

export function WorkspaceOverviewScreen(): ReactElement {
  const {
    activeWorkspace,
    cards,
    cardsState,
    decks,
    decksState,
    ensureCardsLoaded,
    ensureDecksLoaded,
    refreshCards,
    refreshDecks,
  } = useAppData();

  useEffect(() => {
    void ensureCardsLoaded();
    void ensureDecksLoaded();
  }, [ensureCardsLoaded, ensureDecksLoaded]);

  const activeCards = cards.filter((card) => card.deletedAt === null);
  const activeDecks = decks.filter((deck) => deck.deletedAt === null);
  const tagsCount = makeWorkspaceTagsSummary(cards).tags.length;
  const dueCount = activeCards.filter((card) => card.dueAt !== null && new Date(card.dueAt).getTime() <= Date.now()).length;
  const newCount = activeCards.filter((card) => card.fsrsCardState === "new").length;
  const reviewedCount = activeCards.filter((card) => card.reps > 0).length;
  const resourceErrorMessage = decksState.status === "error"
    ? decksState.errorMessage
    : cardsState.status === "error"
      ? cardsState.errorMessage
      : "";

  if (
    (decksState.status === "loading" && !decksState.hasLoaded)
    || (cardsState.status === "loading" && !cardsState.hasLoaded)
  ) {
    return (
      <SettingsShell
        title="Overview"
        subtitle="Review workspace details and today counts."
        activeSection="workspace"
      >
        <p className="subtitle">Loading workspace overview…</p>
      </SettingsShell>
    );
  }

  if (
    (decksState.status === "error" && !decksState.hasLoaded)
    || (cardsState.status === "error" && !cardsState.hasLoaded)
  ) {
    return (
      <SettingsShell
        title="Overview"
        subtitle="Review workspace details and today counts."
        activeSection="workspace"
      >
        <p className="error-banner">{resourceErrorMessage}</p>
        <button
          className="primary-btn"
          type="button"
          onClick={() => {
            void refreshCards();
            void refreshDecks();
          }}
        >
          Retry
        </button>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title="Overview"
      subtitle="Review workspace details and today counts."
      activeSection="workspace"
    >
      {resourceErrorMessage !== "" ? <p className="error-banner">{resourceErrorMessage}</p> : null}

      <div className="settings-summary-grid">
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Workspace</span>
          <strong className="panel-subtitle">{activeWorkspace?.name ?? "Workspace unavailable"}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Cards</span>
          <strong className="panel-subtitle">{activeCards.length}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Decks</span>
          <strong className="panel-subtitle">{activeDecks.length}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Tags</span>
          <strong className="panel-subtitle">{tagsCount}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Due</span>
          <strong className="panel-subtitle">{dueCount}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">New</span>
          <strong className="panel-subtitle">{newCount}</strong>
        </article>
        <article className="content-card settings-summary-card">
          <span className="cell-secondary">Reviewed</span>
          <strong className="panel-subtitle">{reviewedCount}</strong>
        </article>
      </div>
    </SettingsShell>
  );
}
