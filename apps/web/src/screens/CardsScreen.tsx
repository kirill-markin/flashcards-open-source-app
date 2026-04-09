import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../appData";
import { getCardFilterActiveDimensionCount, normalizeCardFilter } from "../cardFilters";
import { EFFORT_LEVELS } from "../deckFilters";
import { useI18n } from "../i18n";
import { CardTagsInput, type CardTagsInputHandle } from "./CardTagsInput";
import { EditableCardEffortCell, EditableCardTagsCell, EditableCardTextCell } from "./CardsTableEditors";
import { queryLocalCardsPage } from "../localDb/cards";
import { loadWorkspaceTagsSummary } from "../localDb/workspace";
import type { Card, CardFilter, CardQuerySort, CardQuerySortDirection, CardQuerySortKey, QueryCardsPage, TagSuggestion, UpdateCardInput } from "../types";
import {
  buildCardsLoadingRowPreview,
  readCardsLoadingSnapshot,
  writeCardsLoadingSnapshot,
} from "./loadingSnapshots";
import { formatCardFilterSummary, formatEffortLevelLabel, formatNullableDateTime, formatTagSummary } from "./featureFormatting";

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

function normalizeCardsSearchText(searchText: string): string | null {
  const normalizedSearchText = searchText.trim();
  return normalizedSearchText === "" ? null : normalizedSearchText;
}

function createEmptyCardFilter(): CardFilter {
  return {
    tags: [],
    effort: [],
  };
}

function toggleCardFilterEffort(
  effortLevels: ReadonlyArray<Card["effortLevel"]>,
  effortLevel: Card["effortLevel"],
): ReadonlyArray<Card["effortLevel"]> {
  if (effortLevels.includes(effortLevel)) {
    return effortLevels.filter((value) => value !== effortLevel);
  }

  return [...effortLevels, effortLevel];
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
    localReadVersion,
    refreshLocalData,
    updateCardItem,
    setErrorMessage,
  } = useAppData();
  const { t, formatDateTime, formatNumber } = useI18n();
  const [searchText, setSearchText] = useState<string>("");
  const [debouncedSearchText, setDebouncedSearchText] = useState<string>("");
  const [sorts, setSorts] = useState<ReadonlyArray<CardQuerySort>>([]);
  const [cardFilter, setCardFilter] = useState<CardFilter | null>(null);
  const [draftCardFilter, setDraftCardFilter] = useState<CardFilter | null>(null);
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState<boolean>(false);
  const [savingCardId, setSavingCardId] = useState<string>("");
  const [cardsQueryState, setCardsQueryState] = useState<CardsQueryState>(createInitialCardsQueryState);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLTableRowElement | null>(null);
  const filterWrapRef = useRef<HTMLDivElement | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const filterTagsInputRef = useRef<CardTagsInputHandle | null>(null);
  const requestSequenceRef = useRef<number>(0);
  const [tagSuggestions, setTagSuggestions] = useState<ReadonlyArray<TagSuggestion>>([]);

  const normalizedSearchText = normalizeCardsSearchText(debouncedSearchText);
  const activeFilterDimensionCount = getCardFilterActiveDimensionCount(cardFilter);
  const hasActiveSearchOrFilter = normalizedSearchText !== null || cardFilter !== null;
  const draftFilterValue = draftCardFilter ?? createEmptyCardFilter();
  const cardsLoadingSnapshot = activeWorkspace === null ? null : readCardsLoadingSnapshot(activeWorkspace.workspaceId);
  const isInitialCardsLoad = cardsQueryState.isLoading && cardsQueryState.hasLoaded === false;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, cardsSearchDebounceMs);

    return () => window.clearTimeout(timeoutId);
  }, [searchText]);

  async function loadFirstPage(): Promise<void> {
    if (activeWorkspace === null) {
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
      const [nextPage, tagsSummary] = await Promise.all([
        queryLocalCardsPage(activeWorkspace.workspaceId, {
          searchText: normalizedSearchText,
          cursor: null,
          limit: cardsPageSize,
          sorts,
          filter: cardFilter,
        }),
        loadWorkspaceTagsSummary(activeWorkspace.workspaceId),
      ]);

      if (requestSequenceRef.current !== requestSequence) {
        return;
      }

      setTagSuggestions(tagsSummary.tags.map((tagSummary) => ({
        tag: tagSummary.tag,
        countState: "ready",
        cardsCount: tagSummary.cardsCount,
      })));
      writeCardsLoadingSnapshot({
        version: 1,
        workspaceId: activeWorkspace.workspaceId,
        totalCount: nextPage.totalCount,
        rows: nextPage.cards.slice(0, 8).map((card) => buildCardsLoadingRowPreview(card)),
        savedAt: new Date().toISOString(),
      });
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
      activeWorkspace === null
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
      const nextPage = await queryLocalCardsPage(activeWorkspace.workspaceId, {
        searchText: normalizedSearchText,
        cursor: currentCursor,
        limit: cardsPageSize,
        sorts,
        filter: cardFilter,
      });

      if (requestSequenceRef.current !== requestSequence) {
        return;
      }

      setCardsQueryState((currentState) => mergeCardsPage(currentState, nextPage));
    } catch (error) {
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
  }, [activeWorkspace, cardFilter, localReadVersion, normalizedSearchText, sorts]);

  useEffect(() => {
    if (!isFilterPopoverOpen) {
      return;
    }

    function handleMouseDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (
        filterWrapRef.current !== null
        && filterWrapRef.current.contains(target)
      ) {
        return;
      }

      setIsFilterPopoverOpen(false);
      setDraftCardFilter(cardFilter);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }

      setIsFilterPopoverOpen(false);
      setDraftCardFilter(cardFilter);
    }

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cardFilter, isFilterPopoverOpen]);

  useEffect(() => {
    if (!isFilterPopoverOpen || filterTagsInputRef.current === null) {
      return;
    }

    filterTagsInputRef.current.focusInput();
  }, [isFilterPopoverOpen]);

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
      await refreshLocalData();
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

  function handleFilterToggle(): void {
    if (isFilterPopoverOpen) {
      setIsFilterPopoverOpen(false);
      setDraftCardFilter(cardFilter);
      return;
    }

    setDraftCardFilter(cardFilter);
    setIsFilterPopoverOpen(true);
  }

  function handleFilterCancel(): void {
    setIsFilterPopoverOpen(false);
    setDraftCardFilter(cardFilter);
  }

  function handleFilterClear(): void {
    setDraftCardFilter(null);
  }

  function handleFilterApply(): void {
    const nextTags = filterTagsInputRef.current === null
      ? draftFilterValue.tags
      : filterTagsInputRef.current.flushDraft();
    const nextFilter = normalizeCardFilter({
      tags: nextTags,
      effort: draftFilterValue.effort,
    });
    setCardFilter(nextFilter);
    setDraftCardFilter(nextFilter);
    setIsFilterPopoverOpen(false);
  }

  const countLabel = hasActiveSearchOrFilter
    ? t("cardsScreen.counts.matches", { count: formatNumber(cardsQueryState.totalCount) })
    : t("cardsScreen.counts.total", { count: formatNumber(cardsQueryState.totalCount) });
  const filterButtonLabel = activeFilterDimensionCount === 0
    ? t("cardsScreen.filters.trigger")
    : t("cardsScreen.filters.triggerWithCount", { count: formatNumber(activeFilterDimensionCount) });
  const visibleCountLabel = isInitialCardsLoad && cardsLoadingSnapshot !== null
    ? t("cardsScreen.counts.total", { count: formatNumber(cardsLoadingSnapshot.totalCount) })
    : countLabel;

  return (
    <main className="container" data-testid="cards-screen">
      <section className="panel cards-panel">
        {cardsQueryState.errorMessage !== "" ? <p className="error-banner">{cardsQueryState.errorMessage}</p> : null}
        {cardsQueryState.errorMessage !== "" && cardsQueryState.hasLoaded === false ? (
          <button className="primary-btn cards-loading-retry-btn" type="button" onClick={() => void loadFirstPage()}>
            {t("common.retry")}
          </button>
        ) : null}
        <div className="screen-head cards-screen-head">
          <div>
            <h1 className="title">{t("cardsScreen.title")}</h1>
            <p className="subtitle">{t("cardsScreen.subtitle")}</p>
          </div>
          <div className="screen-actions">
            <span className="badge">{visibleCountLabel}</span>
            <Link className="primary-btn" to="/cards/new" data-testid="cards-new-card">{t("cardForm.title.new")}</Link>
          </div>
        </div>

        <div className="cards-search-bar">
          <label className="cards-search-field">
            <span className="cards-search-label">{t("cardsScreen.search.label")}</span>
            <input
              type="search"
              name="cards-search"
              className="cards-search-input"
              placeholder={t("cardsScreen.search.placeholder")}
              value={searchText}
              data-testid="cards-search-input"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <div ref={filterWrapRef} className="cards-filter-wrap">
            <span className="cards-search-label">{t("cardsScreen.filters.label")}</span>
            <button
              type="button"
              className={`ghost-btn cards-filter-trigger${cardFilter === null ? "" : " cards-filter-trigger-active"}`}
              aria-expanded={isFilterPopoverOpen}
              aria-haspopup="dialog"
              onClick={handleFilterToggle}
            >
              <span>{filterButtonLabel}</span>
            </button>
            {isFilterPopoverOpen ? (
              <div
                ref={filterPopoverRef}
                className="cards-filter-popover"
                role="dialog"
                aria-label={t("cardsScreen.filters.ariaLabel")}
              >
                <div className="cards-filter-section">
                  <span className="deck-form-label">{t("cardsScreen.filters.effort")}</span>
                  <div className="deck-checkbox-list">
                    {EFFORT_LEVELS.map((effortLevel) => (
                      <label key={effortLevel} className="deck-checkbox-option">
                        <input
                          type="checkbox"
                          checked={draftFilterValue.effort.includes(effortLevel)}
                          onChange={() => setDraftCardFilter({
                            tags: draftFilterValue.tags,
                            effort: toggleCardFilterEffort(draftFilterValue.effort, effortLevel),
                          })}
                        />
                        <span>{formatEffortLevelLabel(t, effortLevel)}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="cards-filter-section">
                  <span className="deck-form-label">{t("cardsScreen.filters.tags")}</span>
                  <CardTagsInput
                    ref={filterTagsInputRef}
                    value={draftFilterValue.tags}
                    suggestions={tagSuggestions}
                    placeholder={t("cardTags.inputPlaceholder")}
                    inputName="cards-filter-tags"
                    onChange={(nextTags) => setDraftCardFilter({
                      tags: nextTags,
                      effort: draftFilterValue.effort,
                    })}
                    onEscape={handleFilterCancel}
                  />
                </div>

                <p className="subtitle cards-filter-summary">{formatCardFilterSummary(normalizeCardFilter(draftFilterValue), t)}</p>

                <div className="cards-filter-actions">
                  <button type="button" className="ghost-btn" onClick={handleFilterClear}>{t("cardsScreen.filters.actions.clear")}</button>
                  <button type="button" className="ghost-btn" onClick={handleFilterCancel}>{t("common.cancel")}</button>
                  <button type="button" className="primary-btn" onClick={handleFilterApply}>{t("cardsScreen.filters.actions.apply")}</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div ref={scrollContainerRef} className="txn-scroll cards-scroll">
          <table className="txn-table cards-table">
            <thead>
              <tr>
                <th className="txn-th cards-open-th cards-col-open" />
                <th className="txn-th cards-header-th cards-col-front">{renderSortableHeaderCell("frontText", t("cardsScreen.table.front"))}</th>
                <th className="txn-th cards-header-th cards-col-back">{renderSortableHeaderCell("backText", t("cardsScreen.table.back"))}</th>
                <th className="txn-th cards-header-th cards-col-tags">{renderSortableHeaderCell("tags", t("cardsScreen.table.tags"))}</th>
                <th className="txn-th cards-header-th cards-col-effort">{renderSortableHeaderCell("effortLevel", t("cardsScreen.table.effort"))}</th>
                <th className="txn-th cards-header-th cards-col-due">{renderSortableHeaderCell("dueAt", t("cardsScreen.table.due"))}</th>
                <th className="txn-th cards-header-th cards-col-reps">{renderSortableHeaderCell("reps", t("cardsScreen.table.reps"))}</th>
                <th className="txn-th cards-header-th cards-col-lapses">{renderSortableHeaderCell("lapses", t("cardsScreen.table.lapses"))}</th>
                <th className="txn-th cards-header-th cards-col-updated">{renderSortableHeaderCell("updatedAt", t("cardsScreen.table.updated"))}</th>
              </tr>
            </thead>
            <tbody>
              {isInitialCardsLoad ? (
                cardsLoadingSnapshot !== null && cardsLoadingSnapshot.rows.length > 0 ? (
                  cardsLoadingSnapshot.rows.map((card) => (
                    <tr key={card.cardId} className="txn-row cards-row cards-loading-row">
                      <td className="txn-cell cards-open-cell cards-col-open">
                        <span className="row-open-link cards-loading-row-open">{t("cardsScreen.loading.open")}</span>
                      </td>
                      <td className="txn-cell cards-col-front cards-cell-multiline">
                        <span className="cards-loading-cell-text">{card.frontText}</span>
                      </td>
                      <td className="txn-cell cards-col-back cards-cell-multiline">
                        <span className="cards-loading-cell-text">{card.backText === "" ? t("common.noBackText") : card.backText}</span>
                      </td>
                      <td className="txn-cell cards-col-tags">
                        <span className="cards-loading-cell-text">{formatTagSummary(card.tags)}</span>
                      </td>
                      <td className="txn-cell cards-col-effort">{formatEffortLevelLabel(t, card.effortLevel)}</td>
                      <td className="txn-cell txn-cell-mono cards-col-due">{formatNullableDateTime(card.dueAt, formatDateTime, t)}</td>
                      <td className="txn-cell txn-cell-mono cards-col-reps">{card.reps}</td>
                      <td className="txn-cell txn-cell-mono cards-col-lapses">{card.lapses}</td>
                      <td className="txn-cell txn-cell-mono cards-col-updated">{formatNullableDateTime(card.updatedAt, formatDateTime, t)}</td>
                    </tr>
                  ))
                ) : (
                  ["loading-1", "loading-2", "loading-3", "loading-4", "loading-5", "loading-6"].map((key) => (
                    <tr key={key} className="txn-row cards-row cards-loading-row" aria-hidden="true">
                      <td className="txn-cell cards-open-cell cards-col-open">
                        <span className="row-open-link cards-loading-row-open">{t("cardsScreen.loading.open")}</span>
                      </td>
                      <td className="txn-cell cards-col-front"><span className="cards-loading-line cards-loading-line-wide" /></td>
                      <td className="txn-cell cards-col-back"><span className="cards-loading-line cards-loading-line-wide" /></td>
                      <td className="txn-cell cards-col-tags"><span className="cards-loading-line cards-loading-line-medium" /></td>
                      <td className="txn-cell cards-col-effort"><span className="cards-loading-line cards-loading-line-short" /></td>
                      <td className="txn-cell cards-col-due"><span className="cards-loading-line cards-loading-line-medium" /></td>
                      <td className="txn-cell cards-col-reps"><span className="cards-loading-line cards-loading-line-shortest" /></td>
                      <td className="txn-cell cards-col-lapses"><span className="cards-loading-line cards-loading-line-shortest" /></td>
                      <td className="txn-cell cards-col-updated"><span className="cards-loading-line cards-loading-line-medium" /></td>
                    </tr>
                  ))
                )
              ) : cardsQueryState.items.map((card) => {
                const isSaving = savingCardId === card.cardId;
                return (
                  <tr key={card.cardId} className="txn-row cards-row">
                    <td className="txn-cell cards-open-cell cards-col-open">
                      <Link className="row-open-link" to={`/cards/${card.cardId}`}>{t("cardsScreen.table.open")}</Link>
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
                    <td className="txn-cell txn-cell-mono cards-col-due">{formatNullableDateTime(card.dueAt, formatDateTime, t)}</td>
                    <td className="txn-cell txn-cell-mono cards-col-reps">{card.reps}</td>
                    <td className="txn-cell txn-cell-mono cards-col-lapses">{card.lapses}</td>
                    <td className="txn-cell txn-cell-mono cards-col-updated">{formatNullableDateTime(card.updatedAt, formatDateTime, t)}</td>
                  </tr>
                );
              })}
              {isInitialCardsLoad ? null : cardsQueryState.items.length === 0 ? (
                <tr>
                  <td className="txn-cell txn-empty" colSpan={9}>
                    {cardsQueryState.totalCount === 0 && hasActiveSearchOrFilter === false
                      ? t("cardsScreen.empty.noCards")
                      : t("cardsScreen.empty.noMatches")}
                  </td>
                </tr>
              ) : null}
              {cardsQueryState.nextCursor !== null ? (
                <tr ref={loadMoreSentinelRef} className="cards-load-more-row" aria-hidden="true">
                  <td className="txn-cell" colSpan={9}>
                    {cardsQueryState.isLoadingMore ? t("cardsScreen.loadingMore") : ""}
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
