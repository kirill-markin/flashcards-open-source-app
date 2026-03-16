import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../appData";
import { ALL_CARDS_DECK_LABEL, ALL_CARDS_DECK_SLUG, formatDeckFilterDefinition } from "../deckFilters";
import { buildSettingsDeckDetailRoute, settingsDeckNewRoute } from "../routes";
import { loadDecksListSnapshot } from "../localDb/decks";
import type { DeckCardStats, DecksListSnapshot } from "../types";

type DeckListEntry = Readonly<{
  id: string;
  title: string;
  filterSummary: string;
  stats: DeckCardStats;
  href: string;
}>;

function buildDeckDetailPath(deckId: string): string {
  return buildSettingsDeckDetailRoute(deckId);
}

function makeDeckListEntries(decksSnapshot: DecksListSnapshot): ReadonlyArray<DeckListEntry> {
  return [{
    id: ALL_CARDS_DECK_SLUG,
    title: ALL_CARDS_DECK_LABEL,
    filterSummary: ALL_CARDS_DECK_LABEL,
    stats: decksSnapshot.allCardsStats,
    href: buildDeckDetailPath(ALL_CARDS_DECK_SLUG),
  }, ...decksSnapshot.deckSummaries.map((deckSummary) => ({
    id: deckSummary.deckId,
    title: deckSummary.name,
    filterSummary: formatDeckFilterDefinition(deckSummary.filterDefinition),
    stats: {
      totalCards: deckSummary.totalCards,
      dueCards: deckSummary.dueCards,
      newCards: deckSummary.newCards,
      reviewedCards: deckSummary.reviewedCards,
    },
    href: buildDeckDetailPath(deckSummary.deckId),
  }))];
}

const emptyDecksSnapshot: DecksListSnapshot = {
  deckSummaries: [],
  allCardsStats: {
    totalCards: 0,
    dueCards: 0,
    newCards: 0,
    reviewedCards: 0,
  },
};

export function DecksScreen(): ReactElement {
  const { activeWorkspace, localReadVersion, refreshLocalData } = useAppData();
  const [decksSnapshot, setDecksSnapshot] = useState<DecksListSnapshot>(emptyDecksSnapshot);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      setIsLoading(true);
      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error("Workspace is unavailable");
        }

        const nextDecksSnapshot = await loadDecksListSnapshot(activeWorkspace.workspaceId);
        if (isCancelled) {
          return;
        }

        setDecksSnapshot(nextDecksSnapshot);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, localReadVersion]);

  const deckListEntries = makeDeckListEntries(decksSnapshot);

  if (isLoading) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Decks</h1>
          <p className="subtitle">Loading decks…</p>
        </section>
      </main>
    );
  }

  if (errorMessage !== "") {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Decks</h1>
          <p className="error-banner">{errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel">
        <div className="screen-head">
          <div>
            <h1 className="title">Decks</h1>
            <p className="subtitle">Decks group related cards so you can study a topic together.</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{deckListEntries.length} total</span>
            <Link className="primary-btn" to={settingsDeckNewRoute}>New deck</Link>
          </div>
        </div>

        <div className="deck-list">
          {deckListEntries.map((deck) => (
            <Link key={deck.id} className="deck-card-link" to={deck.href}>
              <article className="deck-card">
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
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
