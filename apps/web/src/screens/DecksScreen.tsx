import { useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../appData";
import { formatDeckFilterDefinition } from "../deckFilters";

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function DecksScreen(): ReactElement {
  const { decks, decksState, ensureDecksLoaded, refreshDecks } = useAppData();

  useEffect(() => {
    void ensureDecksLoaded();
  }, [ensureDecksLoaded]);

  const resourceErrorMessage = decksState.status === "error" ? decksState.errorMessage : "";

  if (decksState.status === "loading" && !decksState.hasLoaded) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Decks</h1>
          <p className="subtitle">Loading decks…</p>
        </section>
      </main>
    );
  }

  if (decksState.status === "error" && !decksState.hasLoaded) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Decks</h1>
          <p className="error-banner">{decksState.errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshDecks()}>
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
            <span className="badge">{decks.length} total</span>
            <Link className="primary-btn" to="/decks/new">New deck</Link>
          </div>
        </div>

        {decks.length === 0 ? (
          <section className="content-card deck-card-empty">
            <p className="subtitle">You haven't created any decks yet.</p>
          </section>
        ) : (
          <div className="deck-list">
            {decks.map((deck) => (
              <article key={deck.deckId} className="deck-card">
                <div className="deck-card-head">
                  <h2 className="deck-card-title">{deck.name}</h2>
                </div>
                <p className="deck-card-summary">{formatDeckFilterDefinition(deck.filterDefinition)}</p>
                <div className="deck-card-meta">
                  <span className="deck-card-meta-label">Updated</span>
                  <span className="txn-cell-mono">{formatTimestamp(deck.updatedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
