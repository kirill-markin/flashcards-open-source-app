import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../appData";
import {
  ALL_CARDS_REVIEW_FILTER,
  cardsMatchingDeck,
  deriveActiveCards,
  makeDeckCardStats,
} from "../appData/domain";
import { ALL_CARDS_DECK_LABEL, ALL_CARDS_DECK_SLUG, formatDeckFilterDefinition } from "../deckFilters";
import { buildSettingsDeckEditRoute, reviewRoute, settingsDecksRoute } from "../routes";
import type { Card, Deck, ReviewFilter } from "../types";

type DeckDetailState = Readonly<{
  title: string;
  filterSummary: string;
  cards: ReadonlyArray<Card>;
  reviewFilter: ReviewFilter;
  allowsEditing: boolean;
  emptyMessage: string;
}>;

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

function renderTags(tags: ReadonlyArray<string>): string {
  return tags.length === 0 ? "—" : tags.join(", ");
}

function buildDeckEditPath(deckId: string): string {
  return buildSettingsDeckEditRoute(deckId);
}

function makeDeckDetailState(
  deckId: string,
  cards: ReadonlyArray<Card>,
  decks: ReadonlyArray<Deck>,
): DeckDetailState | null {
  if (deckId === ALL_CARDS_DECK_SLUG) {
    return {
      title: ALL_CARDS_DECK_LABEL,
      filterSummary: ALL_CARDS_DECK_LABEL,
      cards: deriveActiveCards(cards),
      reviewFilter: ALL_CARDS_REVIEW_FILTER,
      allowsEditing: false,
      emptyMessage: "You haven't created any cards yet.",
    };
  }

  const deck = decks.find((candidateDeck) => candidateDeck.deckId === deckId && candidateDeck.deletedAt === null);
  if (deck === undefined) {
    return null;
  }

  return {
    title: deck.name,
    filterSummary: formatDeckFilterDefinition(deck.filterDefinition),
    cards: cardsMatchingDeck(deck, cards),
    reviewFilter: {
      kind: "deck",
      deckId: deck.deckId,
    },
    allowsEditing: true,
    emptyMessage: "This deck doesn't have any matching cards yet.",
  };
}

export function DeckDetailScreen(): ReactElement {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const {
    cards,
    decks,
    ensureCardsLoaded,
    ensureDecksLoaded,
    refreshCards,
    refreshDecks,
    getDeckById,
    deleteDeckItem,
    openReview,
    setErrorMessage,
  } = useAppData();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [screenErrorMessage, setScreenErrorMessage] = useState<string>("");
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const currentDeckId = deckId ?? "";
  const detailState = makeDeckDetailState(currentDeckId, cards, decks);
  const stats = detailState === null ? null : makeDeckCardStats(detailState.cards, Date.now());

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    if (deckId === undefined) {
      setScreenErrorMessage("Deck not found.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setScreenErrorMessage("");

    try {
      await Promise.all([ensureCardsLoaded(), ensureDecksLoaded()]);
      if (deckId !== ALL_CARDS_DECK_SLUG) {
        await getDeckById(deckId);
      }
    } catch (error) {
      setScreenErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [deckId, ensureCardsLoaded, ensureDecksLoaded, getDeckById]);

  useEffect(() => {
    void loadScreenData();
  }, [loadScreenData]);

  async function handleDelete(): Promise<void> {
    if (deckId === undefined || deckId === ALL_CARDS_DECK_SLUG) {
      setScreenErrorMessage("System deck cannot be deleted.");
      return;
    }

    if (window.confirm("Delete this deck?") === false) {
      return;
    }

    setIsDeleting(true);
    setScreenErrorMessage("");
    setErrorMessage("");

    try {
      await deleteDeckItem(deckId);
      navigate(settingsDecksRoute);
    } catch (error) {
      setScreenErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeleting(false);
    }
  }

  function handleOpenReview(): void {
    if (detailState === null) {
      return;
    }

    openReview(detailState.reviewFilter);
    navigate(reviewRoute);
  }

  if (isLoading) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Deck</h1>
          <p className="subtitle">Loading deck…</p>
        </section>
      </main>
    );
  }

  if (screenErrorMessage !== "" && detailState === null) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">Deck</h1>
          <p className="error-banner">{screenErrorMessage}</p>
          <button
            className="primary-btn"
            type="button"
            onClick={() => {
              void refreshCards();
              void refreshDecks();
              void loadScreenData();
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
        {screenErrorMessage !== "" ? <p className="error-banner">{screenErrorMessage}</p> : null}
        <div className="screen-head">
          <div>
            <h1 className="title">{detailState?.title ?? "Deck"}</h1>
            <p className="subtitle">Inspect the deck rules, matching cards, and review entry point.</p>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to={settingsDecksRoute}>Back</Link>
            {detailState !== null ? (
              <button type="button" className="primary-btn" onClick={handleOpenReview}>
                Open review
              </button>
            ) : null}
            {detailState?.allowsEditing ? (
              <Link className="ghost-btn" to={buildDeckEditPath(currentDeckId)}>Edit deck</Link>
            ) : null}
          </div>
        </div>

        {detailState === null || stats === null ? (
          <section className="content-card deck-detail-empty">
            <p className="subtitle">Deck not found.</p>
          </section>
        ) : (
          <div className="deck-detail-layout">
            <section className="deck-detail-panel">
              <h2 className="panel-subtitle">Deck rules</h2>
              <div className="deck-detail-stats">
                <div className="content-card deck-detail-stat-card">
                  <span className="deck-detail-stat-label">Cards</span>
                  <span className="deck-detail-stat-value">{stats.totalCards}</span>
                </div>
                <div className="content-card deck-detail-stat-card">
                  <span className="deck-detail-stat-label">Due</span>
                  <span className="deck-detail-stat-value">{stats.dueCards}</span>
                </div>
                <div className="content-card deck-detail-stat-card">
                  <span className="deck-detail-stat-label">New</span>
                  <span className="deck-detail-stat-value">{stats.newCards}</span>
                </div>
              </div>
              <div className="content-card deck-detail-summary-card">
                <span className="deck-detail-stat-label">Summary</span>
                <p className="deck-card-summary">{detailState.filterSummary}</p>
              </div>

              {detailState.allowsEditing ? (
                <button
                  type="button"
                  className="ghost-btn deck-detail-delete-btn"
                  disabled={isDeleting}
                  onClick={() => void handleDelete()}
                >
                  {isDeleting ? "Deleting…" : "Delete deck"}
                </button>
              ) : null}
            </section>

            <section className="deck-detail-panel">
              <div className="deck-detail-cards-head">
                <h2 className="panel-subtitle">Matching cards</h2>
                <span className="badge">{detailState.cards.length} cards</span>
              </div>
              {detailState.cards.length === 0 ? (
                <section className="content-card deck-detail-empty">
                  <p className="subtitle">{detailState.emptyMessage}</p>
                </section>
              ) : (
                <div className="deck-detail-cards">
                  {detailState.cards.map((card) => (
                    <article key={card.cardId} className="content-card deck-detail-card">
                      <div className="deck-detail-card-head">
                        <h3 className="panel-subtitle deck-detail-card-title">{card.frontText}</h3>
                        <Link className="ghost-btn deck-detail-card-open" to={`/cards/${card.cardId}`}>
                          Open
                        </Link>
                      </div>
                      <p className="deck-detail-card-back">{card.backText === "" ? "No back text" : card.backText}</p>
                      <div className="deck-detail-card-meta">
                        <span>{card.effortLevel}</span>
                        <span>{renderTags(card.tags)}</span>
                        <span>Due {formatTimestamp(card.dueAt)}</span>
                        <span>Reps {card.reps}</span>
                        <span>Lapses {card.lapses}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
