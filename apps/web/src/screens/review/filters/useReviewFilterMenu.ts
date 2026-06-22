import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ALL_CARDS_REVIEW_FILTER } from "../../../appData/domain";
import { useI18n } from "../../../i18n";
import { settingsDecksRoute } from "../../../routes";
import type { DeckSummary, ReviewFilter, WorkspaceTagSummary } from "../../../types";

const REVIEW_FILTER_DECK_PREFIX = "deck:";
const REVIEW_FILTER_TAG_PREFIX = "tag:";
const REVIEW_FILTER_LISTBOX_ID = "review-filter-listbox";

export type ReviewFilterMenuItem = Readonly<{
  kind: "action";
  key: "edit-decks";
  label: string;
  href: string;
}>;

export type ReviewFilterChoiceMenuItem = Readonly<{
  isSelected: boolean;
  key: string;
  label: string;
  reviewFilter: ReviewFilter;
  subtitle: string | null;
}>;

type UseReviewFilterMenuParams = Readonly<{
  deckSummaries: ReadonlyArray<DeckSummary>;
  onSelectReviewFilter: (reviewFilter: ReviewFilter) => void;
  reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>;
  selectedReviewFilter: ReviewFilter;
}>;

export type UseReviewFilterMenuResult = Readonly<{
  activeReviewFilterOptionId: string | null;
  activeReviewFilterOptionKey: string | null;
  getReviewFilterOptionId: (optionKey: string) => string;
  handleCloseMenu: () => void;
  handleReviewFilterComboboxKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  handleReviewFilterListboxKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handleReviewFilterMenuToggle: () => void;
  handleReviewFilterSelect: (reviewFilter: ReviewFilter) => void;
  hasVisibleReviewFilterChoices: boolean;
  isReviewFilterMenuOpen: boolean;
  reviewDeckSearchInputRef: React.RefObject<HTMLInputElement | null>;
  reviewDeckSearchText: string;
  reviewFilterListboxId: string;
  reviewFilterListboxRef: React.RefObject<HTMLDivElement | null>;
  reviewFilterMenuItems: ReadonlyArray<ReviewFilterMenuItem>;
  reviewFilterMenuWrapRef: React.RefObject<HTMLDivElement | null>;
  reviewFilterTriggerRef: React.RefObject<HTMLButtonElement | null>;
  setReviewDeckSearchText: (value: string) => void;
  shouldShowReviewDeckSearch: boolean;
  visibleReviewDeckFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
  visibleReviewTagFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
}>;

function toReviewFilterMenuItemKey(reviewFilter: ReviewFilter): string {
  if (reviewFilter.kind === "allCards") {
    return "allCards";
  }

  if (reviewFilter.kind === "deck") {
    return `${REVIEW_FILTER_DECK_PREFIX}${reviewFilter.deckId}`;
  }

  return `${REVIEW_FILTER_TAG_PREFIX}${reviewFilter.tag}`;
}

function buildReviewDeckFilterMenuItems(
  decks: ReadonlyArray<DeckSummary>,
  selectedReviewFilter: ReviewFilter,
  allCardsLabel: string,
  deckSubtitle: string,
): Array<ReviewFilterChoiceMenuItem> {
  return [
    {
      key: toReviewFilterMenuItemKey(ALL_CARDS_REVIEW_FILTER),
      label: allCardsLabel,
      reviewFilter: ALL_CARDS_REVIEW_FILTER,
      subtitle: null,
      isSelected: toReviewFilterMenuItemKey(selectedReviewFilter) === toReviewFilterMenuItemKey(ALL_CARDS_REVIEW_FILTER),
    },
    ...decks.map((deck) => {
      const reviewFilter: ReviewFilter = {
        kind: "deck",
        deckId: deck.deckId,
      };

      return {
        key: toReviewFilterMenuItemKey(reviewFilter),
        label: deck.name,
        reviewFilter,
        subtitle: deckSubtitle,
        isSelected: toReviewFilterMenuItemKey(selectedReviewFilter) === toReviewFilterMenuItemKey(reviewFilter),
      };
    }),
  ];
}

function buildReviewTagFilterMenuItems(
  reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>,
  selectedReviewFilter: ReviewFilter,
): Array<ReviewFilterChoiceMenuItem> {
  return reviewTagSummaries.map((tagSummary) => {
    const reviewFilter: ReviewFilter = {
      kind: "tag",
      tag: tagSummary.tag,
    };

    return {
      key: toReviewFilterMenuItemKey(reviewFilter),
      label: `${tagSummary.tag} (${tagSummary.cardsCount})`,
      reviewFilter,
      subtitle: null,
      isSelected: toReviewFilterMenuItemKey(selectedReviewFilter) === toReviewFilterMenuItemKey(reviewFilter),
    };
  });
}

function buildReviewFilterMenuItems(label: string): Array<ReviewFilterMenuItem> {
  return [{
    kind: "action",
    key: "edit-decks",
    label,
    href: settingsDecksRoute,
  }];
}

function normalizeReviewFilterSearchText(searchText: string): string {
  return searchText.trim().toLowerCase();
}

function toReviewFilterOptionElementId(optionKey: string): string {
  return `${REVIEW_FILTER_LISTBOX_ID}-option-${encodeURIComponent(optionKey)}`;
}

function findSelectedReviewFilterOptionKey(
  items: ReadonlyArray<ReviewFilterChoiceMenuItem>,
): string | null {
  return items.find((item) => item.isSelected)?.key ?? null;
}

function findDefaultReviewFilterOptionKey(
  items: ReadonlyArray<ReviewFilterChoiceMenuItem>,
): string | null {
  return findSelectedReviewFilterOptionKey(items) ?? items[0]?.key ?? null;
}

function resolveActiveReviewFilterOptionKey(
  items: ReadonlyArray<ReviewFilterChoiceMenuItem>,
  currentActiveKey: string | null,
): string | null {
  if (items.length === 0) {
    return null;
  }

  if (currentActiveKey !== null && items.some((item) => item.key === currentActiveKey)) {
    return currentActiveKey;
  }

  return findDefaultReviewFilterOptionKey(items);
}

function findAdjacentReviewFilterOptionKey(
  items: ReadonlyArray<ReviewFilterChoiceMenuItem>,
  currentActiveKey: string | null,
  direction: -1 | 1,
): string | null {
  if (items.length === 0) {
    return null;
  }

  const currentIndex = items.findIndex((item) => item.key === currentActiveKey);
  if (currentIndex === -1) {
    return findDefaultReviewFilterOptionKey(items);
  }

  const nextIndex = (currentIndex + direction + items.length) % items.length;
  return items[nextIndex]?.key ?? null;
}

function findReviewFilterOptionByKey(
  items: ReadonlyArray<ReviewFilterChoiceMenuItem>,
  optionKey: string,
): ReviewFilterChoiceMenuItem | null {
  return items.find((item) => item.key === optionKey) ?? null;
}

function isReviewFilterComboboxComposing(event: ReactKeyboardEvent<HTMLInputElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export function useReviewFilterMenu(params: UseReviewFilterMenuParams): UseReviewFilterMenuResult {
  const {
    deckSummaries,
    onSelectReviewFilter,
    reviewTagSummaries,
    selectedReviewFilter,
  } = params;
  const { t } = useI18n();
  const [isReviewFilterMenuOpen, setIsReviewFilterMenuOpen] = useState<boolean>(false);
  const [reviewDeckSearchText, setReviewDeckSearchText] = useState<string>("");
  const [activeReviewFilterOptionKey, setActiveReviewFilterOptionKey] = useState<string | null>(null);
  const reviewFilterMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const reviewFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reviewDeckSearchInputRef = useRef<HTMLInputElement | null>(null);
  const reviewFilterListboxRef = useRef<HTMLDivElement | null>(null);
  const reviewDeckFilterMenuItems = buildReviewDeckFilterMenuItems(
    deckSummaries,
    selectedReviewFilter,
    t("filters.allCards"),
    t("reviewFilterMenu.deckSmartFilterLabel"),
  );
  const reviewTagFilterMenuItems = buildReviewTagFilterMenuItems(reviewTagSummaries, selectedReviewFilter);
  const reviewFilterMenuItems = buildReviewFilterMenuItems(t("reviewFilterMenu.editDecks"));
  const totalReviewFilterChoicesCount = reviewDeckFilterMenuItems.length
    + reviewTagFilterMenuItems.length;
  const shouldShowReviewDeckSearch = totalReviewFilterChoicesCount > 7;
  const normalizedReviewDeckSearchText = normalizeReviewFilterSearchText(reviewDeckSearchText);
  const visibleReviewDeckFilterMenuItems = shouldShowReviewDeckSearch
    ? reviewDeckFilterMenuItems.filter((item) => item.label.toLowerCase().includes(normalizedReviewDeckSearchText))
    : reviewDeckFilterMenuItems;
  const visibleReviewTagFilterMenuItems = shouldShowReviewDeckSearch
    ? reviewTagFilterMenuItems.filter((item) => item.label.toLowerCase().includes(normalizedReviewDeckSearchText))
    : reviewTagFilterMenuItems;
  const visibleReviewFilterChoiceMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem> = [
    ...visibleReviewDeckFilterMenuItems,
    ...visibleReviewTagFilterMenuItems,
  ];
  const hasVisibleReviewFilterChoices = visibleReviewDeckFilterMenuItems.length > 0
    || visibleReviewTagFilterMenuItems.length > 0;
  const activeReviewFilterOptionId = activeReviewFilterOptionKey === null
    ? null
    : toReviewFilterOptionElementId(activeReviewFilterOptionKey);

  useEffect(() => {
    if (!isReviewFilterMenuOpen) {
      return;
    }

    function handleMouseDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (reviewFilterMenuWrapRef.current !== null && !reviewFilterMenuWrapRef.current.contains(target)) {
        setIsReviewFilterMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isReviewFilterMenuOpen]);

  useEffect(() => {
    if (isReviewFilterMenuOpen || reviewDeckSearchText === "") {
      return;
    }

    setReviewDeckSearchText("");
  }, [isReviewFilterMenuOpen, reviewDeckSearchText]);

  useEffect(() => {
    if (!isReviewFilterMenuOpen) {
      if (activeReviewFilterOptionKey !== null) {
        setActiveReviewFilterOptionKey(null);
      }
      return;
    }

    const nextActiveReviewFilterOptionKey = resolveActiveReviewFilterOptionKey(
      visibleReviewFilterChoiceMenuItems,
      activeReviewFilterOptionKey,
    );
    if (activeReviewFilterOptionKey !== nextActiveReviewFilterOptionKey) {
      setActiveReviewFilterOptionKey(nextActiveReviewFilterOptionKey);
    }
  }, [activeReviewFilterOptionKey, isReviewFilterMenuOpen, visibleReviewFilterChoiceMenuItems]);

  useEffect(() => {
    if (!isReviewFilterMenuOpen || activeReviewFilterOptionId === null) {
      return;
    }

    const activeOptionElement = document.getElementById(activeReviewFilterOptionId);
    if (activeOptionElement instanceof HTMLElement && typeof activeOptionElement.scrollIntoView === "function") {
      activeOptionElement.scrollIntoView({ block: "nearest" });
    }
  }, [activeReviewFilterOptionId, isReviewFilterMenuOpen]);

  useEffect(() => {
    if (!isReviewFilterMenuOpen || !shouldShowReviewDeckSearch) {
      return;
    }

    reviewDeckSearchInputRef.current?.focus();
  }, [isReviewFilterMenuOpen, shouldShowReviewDeckSearch]);

  useEffect(() => {
    if (!isReviewFilterMenuOpen || shouldShowReviewDeckSearch) {
      return;
    }

    reviewFilterListboxRef.current?.focus();
  }, [isReviewFilterMenuOpen, shouldShowReviewDeckSearch]);

  useEffect(() => {
    if (!isReviewFilterMenuOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsReviewFilterMenuOpen(false);
        reviewFilterTriggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isReviewFilterMenuOpen]);

  function handleCloseMenu(): void {
    setReviewDeckSearchText("");
    setActiveReviewFilterOptionKey(null);
    setIsReviewFilterMenuOpen(false);
  }

  function handleReviewFilterMenuToggle(): void {
    setReviewDeckSearchText("");
    if (isReviewFilterMenuOpen) {
      setActiveReviewFilterOptionKey(null);
      setIsReviewFilterMenuOpen(false);
      return;
    }

    setActiveReviewFilterOptionKey(findDefaultReviewFilterOptionKey(visibleReviewFilterChoiceMenuItems));
    setIsReviewFilterMenuOpen(true);
  }

  function handleReviewFilterSelect(reviewFilter: ReviewFilter): void {
    onSelectReviewFilter(reviewFilter);
    handleCloseMenu();
  }

  function preventReviewFilterHandledKeyDown(event: ReactKeyboardEvent<HTMLInputElement | HTMLDivElement>): void {
    event.preventDefault();
    event.stopPropagation();
  }

  function closeReviewFilterMenuAndFocusTrigger(): void {
    setReviewDeckSearchText("");
    setActiveReviewFilterOptionKey(null);
    setIsReviewFilterMenuOpen(false);
    reviewFilterTriggerRef.current?.focus();
  }

  function closeReviewFilterMenuFromKeyboard(event: ReactKeyboardEvent<HTMLInputElement | HTMLDivElement>): void {
    preventReviewFilterHandledKeyDown(event);
    closeReviewFilterMenuAndFocusTrigger();
  }

  function selectActiveReviewFilterOptionFromKeyboard(): void {
    if (activeReviewFilterOptionKey === null) {
      return;
    }

    const activeReviewFilterOption = findReviewFilterOptionByKey(
      visibleReviewFilterChoiceMenuItems,
      activeReviewFilterOptionKey,
    );
    if (activeReviewFilterOption !== null) {
      onSelectReviewFilter(activeReviewFilterOption.reviewFilter);
      closeReviewFilterMenuAndFocusTrigger();
    }
  }

  function moveActiveReviewFilterOption(direction: -1 | 1): void {
    setActiveReviewFilterOptionKey((currentActiveKey) => (
      findAdjacentReviewFilterOptionKey(visibleReviewFilterChoiceMenuItems, currentActiveKey, direction)
    ));
  }

  function handleReviewFilterComboboxKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (!isReviewFilterMenuOpen) {
      return;
    }

    if (isReviewFilterComboboxComposing(event)) {
      return;
    }

    if (event.key === "Escape") {
      closeReviewFilterMenuFromKeyboard(event);
      return;
    }

    if (event.key === "ArrowDown") {
      preventReviewFilterHandledKeyDown(event);
      moveActiveReviewFilterOption(1);
      return;
    }

    if (event.key === "ArrowUp") {
      preventReviewFilterHandledKeyDown(event);
      moveActiveReviewFilterOption(-1);
      return;
    }

    if (event.key === "Enter") {
      preventReviewFilterHandledKeyDown(event);
      selectActiveReviewFilterOptionFromKeyboard();
    }
  }

  function handleReviewFilterListboxKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!isReviewFilterMenuOpen) {
      return;
    }

    if (event.key === "Escape") {
      closeReviewFilterMenuFromKeyboard(event);
      return;
    }

    if (event.key === "ArrowDown") {
      preventReviewFilterHandledKeyDown(event);
      moveActiveReviewFilterOption(1);
      return;
    }

    if (event.key === "ArrowUp") {
      preventReviewFilterHandledKeyDown(event);
      moveActiveReviewFilterOption(-1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      preventReviewFilterHandledKeyDown(event);
      selectActiveReviewFilterOptionFromKeyboard();
    }
  }

  return {
    activeReviewFilterOptionId,
    activeReviewFilterOptionKey,
    getReviewFilterOptionId: toReviewFilterOptionElementId,
    handleCloseMenu,
    handleReviewFilterComboboxKeyDown,
    handleReviewFilterListboxKeyDown,
    handleReviewFilterMenuToggle,
    handleReviewFilterSelect,
    hasVisibleReviewFilterChoices,
    isReviewFilterMenuOpen,
    reviewDeckSearchInputRef,
    reviewDeckSearchText,
    reviewFilterListboxId: REVIEW_FILTER_LISTBOX_ID,
    reviewFilterListboxRef,
    reviewFilterMenuItems,
    reviewFilterMenuWrapRef,
    reviewFilterTriggerRef,
    setReviewDeckSearchText,
    shouldShowReviewDeckSearch,
    visibleReviewDeckFilterMenuItems,
    visibleReviewTagFilterMenuItems,
  };
}
