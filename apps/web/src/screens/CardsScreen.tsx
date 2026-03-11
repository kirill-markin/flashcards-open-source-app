import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { isAuthRedirectError, queryCards } from "../api";
import { useAppData } from "../appData";
import { EditableCardEffortCell, EditableCardTagsCell, EditableCardTextCell } from "./CardsTableEditors";
import { getTagSuggestionsFromCards } from "./CardTagsInput";
import type { Card, CardQuerySort, CardQuerySortDirection, CardQuerySortKey, QueryCardsPage, UpdateCardInput } from "../types";

type CardsQueryState = Readonly<{
  items: ReadonlyArray<Card>;
  totalCount: number;
  nextCursor: string | null;
  hasLoaded: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  errorMessage: string;
}>;

const cardsPageSize = 50;
const cardsSearchDebounceMs = 300;
const maximumUserSortCount = 3;

function createInitialCardsQueryState(): CardsQueryState {
  return {
    items: [],
    totalCount: 0,
    nextCursor: null,
    hasLoaded: false,
    isLoading: false,
    isLoadingMore: false,
    errorMessage: "",
  };
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "new";
  }

  return new Date(value).toLocaleString();
}

function normalizeCardsSearchText(searchText: string): string | null {
  const normalizedSearchText = searchText.trim();
  return normalizedSearchText === "" ? null : normalizedSearchText;
}

export function getDefaultCardSortDirection(sortKey: CardQuerySortKey): CardQuerySortDirection {
  if (sortKey === "updatedAt") {
    return "desc";
  }

  if (sortKey === "dueAt") {
    return "asc";
  }

  return "asc";
}

export function buildNextCardsTableSorts(
  currentSorts: ReadonlyArray<CardQuerySort>,
  sortKey: CardQuerySortKey,
): ReadonlyArray<CardQuerySort> {
  const existingSort = currentSorts.find((sort) => sort.key === sortKey);
  if (existingSort !== undefined) {
    const remainingSorts = currentSorts.filter((sort) => sort.key !== sortKey);
    const nextDirection: CardQuerySortDirection = existingSort.direction === "asc" ? "desc" : "asc";
    return [{
      key: sortKey,
      direction: nextDirection,
    }, ...remainingSorts].slice(0, maximumUserSortCount);
  }

  return [{
    key: sortKey,
    direction: getDefaultCardSortDirection(sortKey),
  }, ...currentSorts].slice(0, maximumUserSortCount);
}

function getSortPriority(
  sorts: ReadonlyArray<CardQuerySort>,
  sortKey: CardQuerySortKey,
): number | null {
  const index = sorts.findIndex((sort) => sort.key === sortKey);
  return index === -1 ? null : index + 1;
}

function mergeCardsPage(
  currentState: CardsQueryState,
  nextPage: QueryCardsPage,
): CardsQueryState {
  return {
    items: [...currentState.items, ...nextPage.cards],
    totalCount: nextPage.totalCount,
    nextCursor: nextPage.nextCursor,
    hasLoaded: true,
    isLoading: false,
    isLoadingMore: false,
    errorMessage: "",
  };
}

export function CardsScreen(): ReactElement {
  const {
    activeWorkspace,
    cards,
    ensureCardsLoaded,
    refreshCards,
    updateCardItem,
    setErrorMessage,
  } = useAppData();
  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>("");
  const [sorts, setSorts] = useState<ReadonlyArray<CardQuerySort>>([]);
  const [savingCardId, setSavingCardId] = useState<string>("");
  const [cardsQueryState, setCardsQueryState] = useState<CardsQueryState>(createInitialCardsQueryState);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLTableRowElement | null>(null);
  const requestSequenceRef = useRef<number>(0);

  const normalizedSearchText = normalizeCardsSearchText(debouncedSearchText);
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  useEffect(() => {
    void ensureCardsLoaded();
  }, [ensureCardsLoaded]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, cardsSearchDebounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [searchText]);

  async function loadFirstPage(): Promise<void> {
    if (activeWorkspaceId === null) {
      setCardsQueryState(createInitialCardsQueryState());
      return;
    }

    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setCardsQueryState((currentState) => ({
      ...currentState,
      isLoading: true,
      isLoadingMore: false,
      errorMessage: "",
    }));

    try {
      const nextPage = await queryCards(activeWorkspaceId, {
        searchText: normalizedSearchText,
        cursor: null,
        limit: cardsPageSize,
        sorts,
      });

      if (requestSequenceRef.current !== requestSequence) {
        return;
      }

      setCardsQueryState({
        items: nextPage.cards,
        totalCount: nextPage.totalCount,
        nextCursor: nextPage.nextCursor,
        hasLoaded: true,
        isLoading: false,
        isLoadingMore: false,
        errorMessage: "",
      });
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      if (requestSequenceRef.current !== requestSequence) {
        return;
      }

      setCardsQueryState((currentState) => ({
        ...currentState,
        hasLoaded: currentState.hasLoaded,
        isLoading: false,
        isLoadingMore: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function loadNextPage(): Promise<void> {
    if (
      activeWorkspaceId === null
      || cardsQueryState.nextCursor === null
      || cardsQueryState.isLoading
      || cardsQueryState.isLoadingMore
    ) {
      return;
    }

    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    const currentCursor = cardsQueryState.nextCursor;
    setCardsQueryState((currentState) => ({
      ...currentState,
      isLoadingMore: true,
      errorMessage: "",
    }));

    try {
      const nextPage = await queryCards(activeWorkspaceId, {
        searchText: normalizedSearchText,
        cursor: currentCursor,
        limit: cardsPageSize,
        sorts,
      });

      if (requestSequenceRef.current !== requestSequence) {
        return;
      }

      setCardsQueryState((currentState) => mergeCardsPage(currentState, nextPage));
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      if (requestSequenceRef.current !== requestSequence) {
        return;
      }

      setCardsQueryState((currentState) => ({
        ...currentState,
        isLoadingMore: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  useEffect(() => {
    void loadFirstPage();
  }, [activeWorkspaceId, normalizedSearchText, sorts]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (scrollContainer === null || sentinel === null || cardsQueryState.nextCursor === null) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      const firstEntry = entries[0];
      if (firstEntry?.isIntersecting) {
        void loadNextPage();
      }
    }, {
      root: scrollContainer,
      rootMargin: "160px 0px",
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cardsQueryState.nextCursor, loadNextPage]);

  async function handleInlineSave(card: Card, patch: UpdateCardInput): Promise<void> {
    setSavingCardId(card.cardId);
    setErrorMessage("");

    try {
      await updateCardItem(card.cardId, patch);
      await refreshCards();
      await loadFirstPage();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingCardId("");
    }
  }

  function handleSortChange(sortKey: CardQuerySortKey): void {
    setSorts((currentSorts) => buildNextCardsTableSorts(currentSorts, sortKey));
    scrollContainerRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function renderSortableHeaderCell(sortKey: CardQuerySortKey, label: string): ReactElement {
    const sortPriority = getSortPriority(sorts, sortKey);
    const activeSort = sorts.find((sort) => sort.key === sortKey);

    return (
      <button
        type="button"
        className={`cards-header-button${sortPriority === null ? "" : " cards-header-button-active"}`}
        onClick={() => handleSortChange(sortKey)}
      >
        <span>{label}</span>
        {sortPriority === null ? null : (
          <span className="cards-header-sort-meta">
            <span className="cards-header-sort-priority">{sortPriority}</span>
            <span className="cards-header-sort-direction">{activeSort?.direction === "asc" ? "↑" : "↓"}</span>
          </span>
        )}
      </button>
    );
  }

  const tagSuggestions = getTagSuggestionsFromCards(cards);
  const countLabel = normalizedSearchText === null
    ? `${cardsQueryState.totalCount} total`
    : `${cardsQueryState.totalCount} matches`;

  if (cardsQueryState.isLoading && cardsQueryState.hasLoaded === false) {
    return (
      <main className="container">
        <section className="panel cards-panel">
          <h1 className="title">Cards</h1>
          <p className="subtitle">Loading cards…</p>
        </section>
      </main>
    );
  }

  if (cardsQueryState.errorMessage !== "" && cardsQueryState.hasLoaded === false) {
    return (
      <main className="container">
        <section className="panel cards-panel">
          <h1 className="title">Cards</h1>
          <p className="error-banner">{cardsQueryState.errorMessage}</p>
          <button className="primary-btn" type="button" onClick={() => void loadFirstPage()}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="container">
      <section className="panel cards-panel">
        {cardsQueryState.errorMessage !== "" ? <p className="error-banner">{cardsQueryState.errorMessage}</p> : null}
        <div className="screen-head cards-screen-head">
          <div>
            <h1 className="title">Cards</h1>
            <p className="subtitle">Cards are the prompts and answers you review to learn and remember.</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{countLabel}</span>
            <Link className="primary-btn" to="/cards/new">New card</Link>
          </div>
        </div>

        <div className="cards-search-bar">
          <label className="cards-search-field">
            <span className="cards-search-label">Search</span>
            <input
              type="search"
              name="cards-search"
              className="cards-search-input"
              placeholder="Search front, back, or tags"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
        </div>

        <div ref={scrollContainerRef} className="txn-scroll cards-scroll">
          <table className="txn-table cards-table">
            <thead>
              <tr>
                <th className="txn-th cards-open-th cards-col-open" />
                <th className="txn-th cards-header-th cards-col-front">{renderSortableHeaderCell("frontText", "Front")}</th>
                <th className="txn-th cards-header-th cards-col-back">{renderSortableHeaderCell("backText", "Back")}</th>
                <th className="txn-th cards-header-th cards-col-tags">{renderSortableHeaderCell("tags", "Tags")}</th>
                <th className="txn-th cards-header-th cards-col-effort">{renderSortableHeaderCell("effortLevel", "Effort")}</th>
                <th className="txn-th cards-header-th cards-col-due">{renderSortableHeaderCell("dueAt", "Due")}</th>
                <th className="txn-th cards-header-th cards-col-reps">{renderSortableHeaderCell("reps", "Reps")}</th>
                <th className="txn-th cards-header-th cards-col-lapses">{renderSortableHeaderCell("lapses", "Lapses")}</th>
                <th className="txn-th cards-header-th cards-col-updated">{renderSortableHeaderCell("updatedAt", "Updated")}</th>
              </tr>
            </thead>
            <tbody>
              {cardsQueryState.items.map((card) => {
                const isSaving = savingCardId === card.cardId;
                return (
                  <tr key={card.cardId} className="txn-row cards-row">
                    <td className="txn-cell cards-open-cell cards-col-open">
                      <Link className="row-open-link" to={`/cards/${card.cardId}`}>Open</Link>
                    </td>
                    <EditableCardTextCell
                      value={card.frontText}
                      displayValue={card.frontText}
                      cellClassName="cards-col-front"
                      multiline={true}
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { frontText: nextValue })}
                    />
                    <EditableCardTextCell
                      value={card.backText}
                      displayValue={card.backText}
                      cellClassName="cards-col-back"
                      multiline={true}
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { backText: nextValue })}
                    />
                    <EditableCardTagsCell
                      value={card.tags}
                      suggestions={tagSuggestions}
                      cellClassName="cards-col-tags cards-tag-cell"
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { tags: nextValue })}
                    />
                    <EditableCardEffortCell
                      value={card.effortLevel}
                      cellClassName="cards-col-effort"
                      saving={isSaving}
                      onCommit={(nextValue) => handleInlineSave(card, { effortLevel: nextValue })}
                    />
                    <td className="txn-cell txn-cell-mono cards-col-due">{formatTimestamp(card.dueAt)}</td>
                    <td className="txn-cell txn-cell-mono cards-col-reps">{card.reps}</td>
                    <td className="txn-cell txn-cell-mono cards-col-lapses">{card.lapses}</td>
                    <td className="txn-cell txn-cell-mono cards-col-updated">{formatTimestamp(card.updatedAt)}</td>
                  </tr>
                );
              })}
              {cardsQueryState.items.length === 0 ? (
                <tr>
                  <td className="txn-cell txn-empty" colSpan={9}>
                    {normalizedSearchText === null
                      ? "You haven't created any cards yet."
                      : "No cards match that search yet."}
                  </td>
                </tr>
              ) : null}
              {cardsQueryState.nextCursor !== null ? (
                <tr ref={loadMoreSentinelRef} className="cards-load-more-row" aria-hidden="true">
                  <td className="txn-cell" colSpan={9}>
                    {cardsQueryState.isLoadingMore ? "Loading more cards…" : ""}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
