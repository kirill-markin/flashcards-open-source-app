import { useEffect, useRef, useState } from "react";
import { ALL_CARDS_REVIEW_FILTER } from "../appData/domain";
import { useI18n } from "../i18n";
import { settingsDecksRoute } from "../routes";
import type { DeckSummary, EffortLevel, ReviewFilter, WorkspaceTagSummary } from "../types";
import { formatEffortLevelLabel } from "./featureFormatting";

const REVIEW_FILTER_DECK_PREFIX = "deck:";
const REVIEW_FILTER_EFFORT_PREFIX = "effort:";
const REVIEW_FILTER_TAG_PREFIX = "tag:";

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
}>;

type UseReviewFilterMenuParams = Readonly<{
  deckSummaries: ReadonlyArray<DeckSummary>;
  onSelectReviewFilter: (reviewFilter: ReviewFilter) => void;
  reviewTagSummaries: ReadonlyArray<WorkspaceTagSummary>;
  selectedReviewFilter: ReviewFilter;
}>;

export type UseReviewFilterMenuResult = Readonly<{
  handleCloseMenu: () => void;
  handleReviewFilterMenuToggle: () => void;
  handleReviewFilterSelect: (reviewFilter: ReviewFilter) => void;
  hasVisibleReviewFilterChoices: boolean;
  isReviewFilterMenuOpen: boolean;
  reviewDeckSearchInputRef: React.RefObject<HTMLInputElement | null>;
  reviewDeckSearchText: string;
  reviewFilterMenuItems: ReadonlyArray<ReviewFilterMenuItem>;
  reviewFilterMenuWrapRef: React.RefObject<HTMLDivElement | null>;
  reviewFilterTriggerRef: React.RefObject<HTMLButtonElement | null>;
  setReviewDeckSearchText: (value: string) => void;
  shouldShowReviewDeckSearch: boolean;
  visibleReviewDeckFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
  visibleReviewEffortFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
  visibleReviewTagFilterMenuItems: ReadonlyArray<ReviewFilterChoiceMenuItem>;
}>;

function toReviewFilterMenuItemKey(reviewFilter: ReviewFilter): string {
  if (reviewFilter.kind === "allCards") {
    return "allCards";
  }

  if (reviewFilter.kind === "deck") {
    return `${REVIEW_FILTER_DECK_PREFIX}${reviewFilter.deckId}`;
  }

  if (reviewFilter.kind === "effort") {
    return `${REVIEW_FILTER_EFFORT_PREFIX}${reviewFilter.effortLevel}`;
  }

  return `${REVIEW_FILTER_TAG_PREFIX}${reviewFilter.tag}`;
}

function buildReviewEffortFilterMenuItems(
  selectedReviewFilter: ReviewFilter,
  formatEffortLabel: (effortLevel: EffortLevel) => string,
): Array<ReviewFilterChoiceMenuItem> {
  return (["fast", "medium", "long"] as const satisfies ReadonlyArray<EffortLevel>).map((effortLevel) => {
    const reviewFilter: ReviewFilter = {
      kind: "effort",
      effortLevel,
    };

    return {
      key: toReviewFilterMenuItemKey(reviewFilter),
      label: formatEffortLabel(effortLevel),
      reviewFilter,
      isSelected: toReviewFilterMenuItemKey(selectedReviewFilter) === toReviewFilterMenuItemKey(reviewFilter),
    };
  });
}

function buildReviewDeckFilterMenuItems(
  decks: ReadonlyArray<DeckSummary>,
  selectedReviewFilter: ReviewFilter,
  allCardsLabel: string,
): Array<ReviewFilterChoiceMenuItem> {
  return [
    {
      key: toReviewFilterMenuItemKey(ALL_CARDS_REVIEW_FILTER),
      label: allCardsLabel,
      reviewFilter: ALL_CARDS_REVIEW_FILTER,
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

export function formatQueueBadge(
  dueCount: number,
  totalCount: number,
  formatNumber: (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string,
  t: (key: "reviewFilterMenu.queueBadgeDue" | "reviewFilterMenu.queueBadgeDueUpcoming", values?: Readonly<Record<string, string | number>>) => string,
): string {
  const upcomingCount = totalCount - dueCount;
  const dueLabel = formatNumber(dueCount);
  if (upcomingCount <= 0) {
    return t("reviewFilterMenu.queueBadgeDue", {
      due: dueLabel,
    });
  }

  return t("reviewFilterMenu.queueBadgeDueUpcoming", {
    due: dueLabel,
    upcoming: formatNumber(upcomingCount),
  });
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
  const reviewFilterMenuWrapRef = useRef<HTMLDivElement | null>(null);
  const reviewFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reviewDeckSearchInputRef = useRef<HTMLInputElement | null>(null);
  const reviewDeckFilterMenuItems = buildReviewDeckFilterMenuItems(deckSummaries, selectedReviewFilter, t("filters.allCards"));
  const reviewEffortFilterMenuItems = buildReviewEffortFilterMenuItems(selectedReviewFilter, (effortLevel) => formatEffortLevelLabel(t, effortLevel));
  const reviewTagFilterMenuItems = buildReviewTagFilterMenuItems(reviewTagSummaries, selectedReviewFilter);
  const reviewFilterMenuItems = buildReviewFilterMenuItems(t("reviewFilterMenu.editDecks"));
  const totalReviewFilterChoicesCount = reviewDeckFilterMenuItems.length
    + reviewEffortFilterMenuItems.length
    + reviewTagFilterMenuItems.length;
  const shouldShowReviewDeckSearch = totalReviewFilterChoicesCount > 7;
  const normalizedReviewDeckSearchText = normalizeReviewFilterSearchText(reviewDeckSearchText);
  const visibleReviewDeckFilterMenuItems = shouldShowReviewDeckSearch
    ? reviewDeckFilterMenuItems.filter((item) => item.label.toLowerCase().includes(normalizedReviewDeckSearchText))
    : reviewDeckFilterMenuItems;
  const visibleReviewEffortFilterMenuItems = shouldShowReviewDeckSearch
    ? reviewEffortFilterMenuItems.filter((item) => item.label.toLowerCase().includes(normalizedReviewDeckSearchText))
    : reviewEffortFilterMenuItems;
  const visibleReviewTagFilterMenuItems = shouldShowReviewDeckSearch
    ? reviewTagFilterMenuItems.filter((item) => item.label.toLowerCase().includes(normalizedReviewDeckSearchText))
    : reviewTagFilterMenuItems;
  const hasVisibleReviewFilterChoices = visibleReviewDeckFilterMenuItems.length > 0
    || visibleReviewEffortFilterMenuItems.length > 0
    || visibleReviewTagFilterMenuItems.length > 0;

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
    if (!isReviewFilterMenuOpen || !shouldShowReviewDeckSearch) {
      return;
    }

    reviewDeckSearchInputRef.current?.focus();
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
    setIsReviewFilterMenuOpen(false);
  }

  function handleReviewFilterMenuToggle(): void {
    setReviewDeckSearchText("");
    setIsReviewFilterMenuOpen((currentValue) => !currentValue);
  }

  function handleReviewFilterSelect(reviewFilter: ReviewFilter): void {
    onSelectReviewFilter(reviewFilter);
    handleCloseMenu();
  }

  return {
    handleCloseMenu,
    handleReviewFilterMenuToggle,
    handleReviewFilterSelect,
    hasVisibleReviewFilterChoices,
    isReviewFilterMenuOpen,
    reviewDeckSearchInputRef,
    reviewDeckSearchText,
    reviewFilterMenuItems,
    reviewFilterMenuWrapRef,
    reviewFilterTriggerRef,
    setReviewDeckSearchText,
    shouldShowReviewDeckSearch,
    visibleReviewDeckFilterMenuItems,
    visibleReviewEffortFilterMenuItems,
    visibleReviewTagFilterMenuItems,
  };
}
