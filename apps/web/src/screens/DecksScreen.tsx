import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../appData";
import { ALL_CARDS_DECK_SLUG } from "../deckFilters";
import { useI18n } from "../i18n";
import { buildSettingsDeckDetailRoute, settingsDeckNewRoute } from "../routes";
import { loadDecksListSnapshot } from "../localDb/decks";
import type { DeckCardStats, DecksListSnapshot } from "../types";
import { formatDeckFilterSummary } from "./featureFormatting";

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
    title: "",
    filterSummary: "",
    stats: decksSnapshot.allCardsStats,
    href: buildDeckDetailPath(ALL_CARDS_DECK_SLUG),
  }, ...decksSnapshot.deckSummaries.map((deckSummary) => ({
    id: deckSummary.deckId,
    title: deckSummary.name,
    filterSummary: "",
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
  const { t, formatNumber } = useI18n();
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
          <h1 className="title">{t("decksScreen.title")}</h1>
          <p className="subtitle">{t("loading.decks")}</p>
        </section>
      </main>
    );
  }

  if (errorMessage !== "") {
    return (
      <main className="container">
        <section className="panel">
          <h1 className="title">{t("decksScreen.title")}</h1>
          <p className="error-banner">{errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void refreshLocalData()}>
            {t("common.retry")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container" data-testid="decks-screen">
      <section className="panel">
        <div className="screen-head">
          <div>
            <h1 className="title">{t("decksScreen.title")}</h1>
            <p className="subtitle">{t("decksScreen.subtitle")}</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{t("decksScreen.counts.total", { count: formatNumber(deckListEntries.length) })}</span>
            <Link className="primary-btn" to={settingsDeckNewRoute} data-testid="decks-new-deck">{t("decksScreen.newDeck")}</Link>
          </div>
        </div>

        <div className="deck-list">
          {deckListEntries.map((deck) => {
            const title = deck.id === ALL_CARDS_DECK_SLUG ? t("filters.allCards") : deck.title;
            const filterSummary = deck.id === ALL_CARDS_DECK_SLUG
              ? t("filters.allCards")
              : formatDeckFilterSummary(
                decksSnapshot.deckSummaries.find((deckSummary) => deckSummary.deckId === deck.id)?.filterDefinition ?? {
                  version: 2,
                  effortLevels: [],
                  tags: [],
                },
                t,
              );

            return (
            <Link key={deck.id} className="deck-card-link" to={deck.href}>
              <article className="deck-card">
                <div className="deck-card-head">
                  <h2 className="deck-card-title">{title}</h2>
                  <span className="badge">{t("decksScreen.counts.due", { count: formatNumber(deck.stats.dueCards) })}</span>
                </div>
                <p className="deck-card-summary">{filterSummary}</p>
                <div className="deck-card-stats" aria-label={t("decksScreen.emptyStatsAriaLabel", { deckName: title })}>
                  <span className="deck-card-stat">
                    <span className="deck-card-stat-value">{formatNumber(deck.stats.totalCards)}</span>
                    <span className="deck-card-stat-label">{t("decksScreen.statLabels.cards")}</span>
                  </span>
                  <span className="deck-card-stat">
                    <span className="deck-card-stat-value">{formatNumber(deck.stats.newCards)}</span>
                    <span className="deck-card-stat-label">{t("decksScreen.statLabels.new")}</span>
                  </span>
                  <span className="deck-card-stat">
                    <span className="deck-card-stat-value">{formatNumber(deck.stats.reviewedCards)}</span>
                    <span className="deck-card-stat-label">{t("decksScreen.statLabels.reviewed")}</span>
                  </span>
                </div>
              </article>
            </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
