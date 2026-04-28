import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAppData } from "../../../../appData";
import { ALL_CARDS_REVIEW_FILTER } from "../../../../appData/domain";
import { ALL_CARDS_DECK_SLUG } from "../../../../deckFilters";
import { useI18n } from "../../../../i18n";
import { buildSettingsDeckEditRoute, reviewRoute, settingsDecksRoute } from "../../../../routes";
import { loadCardsMatchingDeck } from "../../../../localDb/cards";
import { loadDeckById, loadDecksListSnapshot } from "../../../../localDb/decks";
import type { Card, Deck, ReviewFilter } from "../../../../types";
import { formatDeckFilterSummary, formatEffortLevelLabel, formatNullableDateTime, formatTagSummary } from "../../../shared/featureFormatting";

type DeckDetailState = Readonly<{
  title: string;
  filterSummary: string;
  cards: ReadonlyArray<Card>;
  reviewFilter: ReviewFilter;
  allowsEditing: boolean;
  emptyMessage: string;
}>;

function buildDeckEditPath(deckId: string): string {
  return buildSettingsDeckEditRoute(deckId);
}

export function DeckDetailScreen(): ReactElement {
  const { deckId } = useParams();
  const navigate = useNavigate();
  const { t, formatCount, formatDateTime, formatNumber } = useI18n();
  const {
    activeWorkspace,
    deleteDeckItem,
    openReview,
    setErrorMessage,
    localReadVersion,
    refreshLocalData,
  } = useAppData();
  const [detailState, setDetailState] = useState<DeckDetailState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [screenErrorMessage, setScreenErrorMessage] = useState<string>("");
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const currentDeckId = deckId ?? "";

  const loadScreenData = useCallback(async function loadScreenData(): Promise<void> {
    if (deckId === undefined) {
      setScreenErrorMessage(t("deckDetail.errors.notFound"));
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setScreenErrorMessage("");

    try {
      if (activeWorkspace === null) {
        throw new Error("Workspace is unavailable");
      }

      if (deckId === ALL_CARDS_DECK_SLUG) {
        const decksSnapshot = await loadDecksListSnapshot(activeWorkspace.workspaceId);
        const allCards = await loadCardsMatchingDeck(activeWorkspace.workspaceId, {
          version: 2,
          effortLevels: [],
          tags: [],
        });
        setDetailState({
          title: t("filters.allCards"),
          filterSummary: t("filters.allCards"),
          cards: allCards,
          reviewFilter: ALL_CARDS_REVIEW_FILTER,
          allowsEditing: false,
          emptyMessage: t("deckDetail.empty.allCards"),
        });
        setScreenErrorMessage("");
        setIsLoading(false);
        void decksSnapshot;
        return;
      }

      const deck = await loadDeckById(activeWorkspace.workspaceId, deckId);
      if (deck === null) {
        setDetailState(null);
        setScreenErrorMessage(t("deckDetail.errors.notFound"));
        setIsLoading(false);
        return;
      }

      const matchingCards = await loadCardsMatchingDeck(activeWorkspace.workspaceId, deck.filterDefinition);
      setDetailState({
        title: deck.name,
        filterSummary: formatDeckFilterSummary(deck.filterDefinition, t),
        cards: matchingCards,
        reviewFilter: {
          kind: "deck",
          deckId: deck.deckId,
        },
        allowsEditing: true,
        emptyMessage: t("deckDetail.empty.deckCards"),
      });
    } catch (error) {
      setScreenErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [activeWorkspace, deckId, t]);

  useEffect(() => {
    void loadScreenData();
  }, [loadScreenData, localReadVersion]);

  async function handleDelete(): Promise<void> {
    if (deckId === undefined || deckId === ALL_CARDS_DECK_SLUG) {
      setScreenErrorMessage(t("deckDetail.errors.systemDeckDelete"));
      return;
    }

    if (window.confirm(t("deckDetail.deleteConfirmation")) === false) {
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
          <h1 className="title">{t("deckDetail.title")}</h1>
          <p className="subtitle">{t("loading.deckDetails")}</p>
        </section>
      </main>
    );
  }

  if (screenErrorMessage !== "" && detailState === null) {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">{t("deckDetail.title")}</h1>
          <p className="error-banner">{screenErrorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
            {t("common.retry")}
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
            <h1 className="title">{detailState?.title ?? t("deckDetail.title")}</h1>
            <p className="subtitle">{t("deckDetail.subtitle")}</p>
          </div>
          <div className="screen-actions">
            <Link className="ghost-btn" to={settingsDecksRoute}>{t("deckDetail.actions.back")}</Link>
            {detailState !== null ? (
              <button type="button" className="primary-btn" onClick={handleOpenReview} data-testid="deck-detail-open-review">
                {t("deckDetail.actions.openReview")}
              </button>
            ) : null}
            {detailState?.allowsEditing ? (
              <Link className="ghost-btn" to={buildDeckEditPath(currentDeckId)}>{t("deckDetail.actions.edit")}</Link>
            ) : null}
          </div>
        </div>

        {detailState === null ? (
          <section className="content-card deck-detail-empty">
            <p className="subtitle">{t("deckDetail.empty.notFound")}</p>
          </section>
        ) : (
          <div className="deck-detail-layout">
            <section className="deck-detail-panel">
              <h2 className="panel-subtitle">{t("deckDetail.rules.title")}</h2>
              <div className="deck-detail-stats">
                <div className="content-card deck-detail-stat-card">
                  <span className="deck-detail-stat-label">{t("deckDetail.rules.cards")}</span>
                  <span className="deck-detail-stat-value">{formatNumber(detailState.cards.length)}</span>
                </div>
                <div className="content-card deck-detail-stat-card">
                  <span className="deck-detail-stat-label">{t("deckDetail.rules.due")}</span>
                  <span className="deck-detail-stat-value">{formatNumber(detailState.cards.filter((card) => card.dueAt === null || new Date(card.dueAt).getTime() <= Date.now()).length)}</span>
                </div>
                <div className="content-card deck-detail-stat-card">
                  <span className="deck-detail-stat-label">{t("deckDetail.rules.new")}</span>
                  <span className="deck-detail-stat-value">{formatNumber(detailState.cards.filter((card) => card.reps === 0 && card.lapses === 0).length)}</span>
                </div>
              </div>
              <div className="content-card deck-detail-summary-card">
                <span className="deck-detail-stat-label">{t("deckDetail.rules.summary")}</span>
                <p className="deck-card-summary">{detailState.filterSummary}</p>
              </div>

              {detailState.allowsEditing ? (
                <button
                  type="button"
                  className="ghost-btn deck-detail-delete-btn"
                  disabled={isDeleting}
                  onClick={() => void handleDelete()}
                >
                  {isDeleting ? t("deckDetail.actions.deleting") : t("deckDetail.actions.delete")}
                </button>
              ) : null}
            </section>

            <section className="deck-detail-panel">
              <div className="deck-detail-cards-head">
                <h2 className="panel-subtitle">{t("deckDetail.matchingCards.title")}</h2>
                <span className="badge">{formatCount(detailState.cards.length, {
                  one: t("common.countLabels.card.one"),
                  other: t("common.countLabels.card.other"),
                })}</span>
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
                        <span className="badge">{formatEffortLevelLabel(t, card.effortLevel)}</span>
                        <span className="badge">{formatTagSummary(card.tags)}</span>
                      </div>
                      <h3 className="panel-subtitle">{card.frontText}</h3>
                      <p className="subtitle">{card.backText === "" ? t("common.noBackText") : card.backText}</p>
                      <div className="review-meta">
                        <span>{t("deckDetail.meta.due", { value: formatNullableDateTime(card.dueAt, formatDateTime, t) })}</span>
                        <span>{t("deckDetail.meta.reps", { count: formatNumber(card.reps) })}</span>
                        <span>{t("deckDetail.meta.lapses", { count: formatNumber(card.lapses) })}</span>
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
