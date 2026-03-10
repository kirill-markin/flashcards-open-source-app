import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../appData";
import {
  cardsMatchingDeck,
  deriveActiveCards,
  deriveActiveDecks,
  makeDeckCardStats,
  type DeckCardStats,
} from "../appData/domain";
import { ALL_CARDS_DECK_LABEL, formatDeckFilterDefinition } from "../deckFilters";
import type { Card, Deck } from "../types";

type DeckListEntry = Readonly<{
  id: string;
  title: string;
  filterSummary: string;
  stats: DeckCardStats;
}>;

/** Prepends the synthetic All cards entry and keeps deck cards read-only on the web list. */
function makeDeckListEntries(cards: ReadonlyArray<Card>, decks: ReadonlyArray<Deck>, nowTimestamp: number): Array<DeckListEntry> {
  const activeCards = deriveActiveCards(cards);

  return [{
    id: "system-all-cards",
    title: ALL_CARDS_DECK_LABEL,
    filterSummary: ALL_CARDS_DECK_LABEL,
    stats: makeDeckCardStats(activeCards, nowTimestamp),
  }, ...deriveActiveDecks(decks).map((deck) => ({
    id: deck.deckId,
    title: deck.name,
    filterSummary: formatDeckFilterDefinition(deck.filterDefinition),
    stats: makeDeckCardStats(cardsMatchingDeck(deck, cards), nowTimestamp),
  }))];
}

export function DecksScreen(): ReactElement {
  const {
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

  const deckListEntries = makeDeckListEntries(cards, decks, Date.now());

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
      <main className="container">
        <section className="panel">
          <h1 className="title">Decks</h1>
          <p className="subtitle">Loading decks…</p>
        </section>
      </main>
    );
  }

  if (
    (decksState.status === "error" && !decksState.hasLoaded)
    || (cardsState.status === "error" && !cardsState.hasLoaded)
  ) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Decks</h1>
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
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel">
        {resourceErrorMessage !== "" ? <p className="error-banner">{resourceErrorMessage}</p> : null}
        <div className="screen-head">
          <div>
            <h1 className="title">Decks</h1>
            <p className="subtitle">Decks group related cards so you can study a topic together.</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{deckListEntries.length} total</span>
            <Link className="primary-btn" to="/decks/new">New deck</Link>
          </div>
        </div>

        <div className="deck-list">
          {deckListEntries.map((deck) => (
            <article key={deck.id} className="deck-card">
              <div className="deck-card-head">
                <h2 className="deck-card-title">{deck.title}</h2>
                <span className="badge">{deck.stats.dueCards} due</span>
              </div>
              <p className="deck-card-summary">{deck.filterSummary}</p>
              <div className="deck-card-stats" aria-label={`${deck.title} stats`}>
                <span className="deck-card-stat">
                  <span className="deck-card-stat-value">{deck.stats.totalCards}</span>
                  <span className="deck-card-stat-label">cards</span>
                </span>
                <span className="deck-card-stat">
                  <span className="deck-card-stat-value">{deck.stats.newCards}</span>
                  <span className="deck-card-stat-label">new</span>
                </span>
                <span className="deck-card-stat">
                  <span className="deck-card-stat-value">{deck.stats.reviewedCards}</span>
                  <span className="deck-card-stat-label">reviewed</span>
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
