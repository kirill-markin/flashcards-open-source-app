import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { useAppData } from "../../../../appData";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  useAppErrorDialog,
} from "../../../../appError/AppErrorContext";
import { ALL_CARDS_DECK_SLUG } from "../../../../deckFilters";
import { createDeckNameComparator } from "../../../../deckNameOrdering";
import type { Locale } from "../../../../i18n/types";
import { useI18n } from "../../../../i18n";
import { buildLibraryDeckDetailRoute, libraryDeckNewRoute } from "../../../../routes";
import { useWorkspacePath, type WorkspacePathBuilder } from "../../../../useWorkspacePath";
import { loadDecksListSnapshot } from "../../../../localDb/cards/decks";
import { captureAppOperationError } from "../../../../observability/appOperationObservation";
import { handleRefreshLocalDataError } from "../../../shared/refreshLocalDataError";
import type { DeckCardStats, DecksListSnapshot } from "../../../../types";
import { formatDeckFilterSummary } from "../../../shared/featureFormatting";

type DeckListEntry = Readonly<{
  id: string;
  title: string;
  filterSummary: string;
  stats: DeckCardStats;
  href: string;
}>;

function buildDeckDetailPath(deckId: string, workspacePath: WorkspacePathBuilder): string {
  return workspacePath(buildLibraryDeckDetailRoute(deckId));
}

function makeDeckListEntries(
  decksSnapshot: DecksListSnapshot,
  workspacePath: WorkspacePathBuilder,
  locale: Locale,
): ReadonlyArray<DeckListEntry> {
  return [{
    id: ALL_CARDS_DECK_SLUG,
    title: "",
    filterSummary: "",
    stats: decksSnapshot.allCardsStats,
    href: buildDeckDetailPath(ALL_CARDS_DECK_SLUG, workspacePath),
  }, ...[...decksSnapshot.deckSummaries].sort(createDeckNameComparator(locale)).map((deckSummary) => ({
    id: deckSummary.deckId,
    title: deckSummary.name,
    filterSummary: "",
    stats: {
      totalCards: deckSummary.totalCards,
      dueCards: deckSummary.dueCards,
      newCards: deckSummary.newCards,
      reviewedCards: deckSummary.reviewedCards,
    },
    href: buildDeckDetailPath(deckSummary.deckId, workspacePath),
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
  const { activeWorkspace, cloudSettings, localReadVersion, refreshLocalData, reviewScheduleVersion, session } = useAppData();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  const { locale, messages, t, formatNumber, formatCount } = useI18n();
  const workspacePath = useWorkspacePath();
  const [decksSnapshot, setDecksSnapshot] = useState<DecksListSnapshot>(emptyDecksSnapshot);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const observationIdentityRef = useRef<Readonly<{
    userId: string | null;
    installationId: string | null;
  }>>({
    userId: null,
    installationId: null,
  });
  const technicalErrorMessage = t("appError.technicalError.message");
  observationIdentityRef.current = {
    userId: session?.userId ?? null,
    installationId: cloudSettings?.installationId ?? null,
  };

  // Deck due counts follow local ratings only while this screen is mounted:
  // docs/fsrs-scheduling-logic.md#non-blocking-review
  useEffect(() => {
    let isCancelled = false;

    async function loadScreenData(): Promise<void> {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setIsLoading(true);
      setErrorMessage("");

      try {
        if (activeWorkspace === null) {
          throw new Error("Workspace is unavailable");
        }

        const nextDecksSnapshot = await loadDecksListSnapshot(activeWorkspace.workspaceId);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isCancelled) {
          return;
        }

        setDecksSnapshot(nextDecksSnapshot);
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }
        if (isCancelled) {
          return;
        }

        if (activeWorkspace !== null) {
          const observationIdentity = observationIdentityRef.current;
          const wasCaptured = captureAppOperationError(error, {
            feature: "settings",
            operation: "deck_list_load",
            userId: observationIdentity.userId,
            workspaceId: activeWorkspace.workspaceId,
            installationId: observationIdentity.installationId,
            entityId: null,
          });
          if (wasCaptured) {
            showCapturedTechnicalError(error);
            setErrorMessage(technicalErrorMessage);
            return;
          }
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!isCancelled && indexedDbOpenRecoveryState.hasFailed() === false) {
          setIsLoading(false);
        }
      }
    }

    void loadScreenData();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, indexedDbOpenRecoveryState, localReadVersion, reviewScheduleVersion]);

  const deckListEntries = makeDeckListEntries(decksSnapshot, workspacePath, locale);

  async function handleRefreshLocalData(): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    try {
      await refreshLocalData();
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }
      handleRefreshLocalDataError({
        error,
        context: {
          feature: "sync",
          operation: "refresh_local_metadata",
          userId: session?.userId ?? null,
          workspaceId: activeWorkspace?.workspaceId ?? null,
          installationId: cloudSettings?.installationId ?? null,
          entityId: activeWorkspace?.workspaceId ?? null,
        },
        setErrorMessage,
        showCapturedTechnicalError,
        technicalErrorMessage,
      });
    }
  }

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
          <button className="primary-btn" type="button" onClick={() => void handleRefreshLocalData()}>
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
            <Link className="primary-btn" to={workspacePath(libraryDeckNewRoute)} data-testid="decks-new-deck">{t("decksScreen.newDeck")}</Link>
          </div>
        </div>

        <div className="deck-list">
          {deckListEntries.map((deck) => {
            const isAllCardsDeck = deck.id === ALL_CARDS_DECK_SLUG;
            const title = isAllCardsDeck ? t("filters.allCards") : deck.title;
            const filterSummary = isAllCardsDeck
              ? null
              : formatDeckFilterSummary(
                decksSnapshot.deckSummaries.find((deckSummary) => deckSummary.deckId === deck.id)?.filterDefinition ?? {
                  version: 2,
                  tags: [],
                },
                t,
              );

            return (
            <Link key={deck.id} className="deck-card-link" to={deck.href}>
              <article className="deck-card">
                <div className="deck-card-head">
                  <h2 className="deck-card-title">{title}</h2>
                  <span className="deck-card-counts">
                    {formatCount(deck.stats.totalCards, messages.decksScreen.statLabels.cards)}
                    {" · "}
                    {t("decksScreen.counts.toStudy", { count: formatNumber(deck.stats.dueCards) })}
                  </span>
                </div>
                {filterSummary === null ? null : <p className="deck-card-summary">{filterSummary}</p>}
              </article>
            </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
