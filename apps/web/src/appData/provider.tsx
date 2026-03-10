import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import type {
  Card,
  Deck,
  ReviewFilter,
  SessionInfo,
  WorkspaceSummary,
} from "../types";
import {
  ALL_CARDS_REVIEW_FILTER,
  isReviewFilterEqual,
  makeReviewQueue,
  makeReviewTimeline,
  resolveReviewFilter,
  reviewFilterTitle,
} from "./domain";
import { createIdleResourceState } from "./resourceState";
import type {
  AppDataContextValue,
  Props,
  SessionLoadState,
} from "./types";
import { useSyncEngine } from "./useSyncEngine";
import { useWorkspaceSession } from "./useWorkspaceSession";

const AppDataContext = createContext<AppDataContextValue | null>(null);
const SELECTED_REVIEW_FILTER_STORAGE_KEY = "selected-review-filter";

function parsePersistedReviewFilter(value: string | null): ReviewFilter {
  if (value === null) {
    return ALL_CARDS_REVIEW_FILTER;
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;
    if (
      typeof parsedValue === "object"
      && parsedValue !== null
      && "kind" in parsedValue
      && parsedValue.kind === "deck"
      && "deckId" in parsedValue
      && typeof parsedValue.deckId === "string"
      && parsedValue.deckId !== ""
    ) {
      return {
        kind: "deck",
        deckId: parsedValue.deckId,
      };
    }
  } catch {
    return ALL_CARDS_REVIEW_FILTER;
  }

  return ALL_CARDS_REVIEW_FILTER;
}

function loadSelectedReviewFilter(): ReviewFilter {
  return parsePersistedReviewFilter(window.localStorage.getItem(SELECTED_REVIEW_FILTER_STORAGE_KEY));
}

export function AppDataProvider(props: Props): ReactElement {
  const { children } = props;
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>("loading");
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string>("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>([]);
  const [isChoosingWorkspace, setIsChoosingWorkspace] = useState<boolean>(false);
  const [cardsState, setCardsState] = useState(createIdleResourceState<Card>());
  const [decksState, setDecksState] = useState(createIdleResourceState<Deck>());
  const [reviewQueueState, setReviewQueueState] = useState(createIdleResourceState<Card>());
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [selectedReviewFilterState, setSelectedReviewFilterState] = useState<ReviewFilter>(loadSelectedReviewFilter);

  const syncEngine = useSyncEngine({
    sessionLoadState,
    session,
    activeWorkspace,
    cardsState,
    decksState,
    reviewQueueState,
    setCardsState,
    setDecksState,
    setReviewQueueState,
    setErrorMessage,
  });

  const selectedReviewFilter = resolveReviewFilter(selectedReviewFilterState, decksState.items);
  const reviewQueue = makeReviewQueue(selectedReviewFilter, decksState.items, cardsState.items);
  const reviewTimeline = makeReviewTimeline(selectedReviewFilter, decksState.items, cardsState.items);
  const selectedReviewFilterTitle = reviewFilterTitle(selectedReviewFilter, decksState.items);

  useEffect(() => {
    if (isReviewFilterEqual(selectedReviewFilterState, selectedReviewFilter)) {
      return;
    }

    setSelectedReviewFilterState(selectedReviewFilter);
  }, [selectedReviewFilter, selectedReviewFilterState]);

  useEffect(() => {
    window.localStorage.setItem(SELECTED_REVIEW_FILTER_STORAGE_KEY, JSON.stringify(selectedReviewFilter));
  }, [selectedReviewFilter]);

  const selectReviewFilter = useCallback(function selectReviewFilter(reviewFilter: ReviewFilter): void {
    setSelectedReviewFilterState(reviewFilter);
  }, []);

  const openReview = useCallback(function openReview(reviewFilter: ReviewFilter): void {
    setSelectedReviewFilterState(reviewFilter);
  }, []);

  const { initialize, chooseWorkspace, createWorkspace } = useWorkspaceSession({
    sessionLoadState,
    session,
    availableWorkspaces,
    setSessionLoadState,
    setSessionErrorMessage,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setCardsState,
    setDecksState,
    setReviewQueueState,
    setErrorMessage,
    hydrateCache: syncEngine.hydrateCache,
    runSync: syncEngine.runSync,
  });

  const value: AppDataContextValue = {
    sessionLoadState,
    sessionErrorMessage,
    session,
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
    workspaceSettings: syncEngine.snapshotRef.current.workspaceSettings,
    selectedReviewFilter,
    selectedReviewFilterTitle,
    cardsState,
    decksState,
    reviewQueueState,
    cards: cardsState.items,
    decks: decksState.items,
    reviewQueue,
    reviewTimeline,
    errorMessage,
    setErrorMessage,
    initialize,
    chooseWorkspace,
    createWorkspace,
    ensureCardsLoaded: syncEngine.ensureCardsLoaded,
    ensureDecksLoaded: syncEngine.ensureDecksLoaded,
    ensureReviewQueueLoaded: syncEngine.ensureReviewQueueLoaded,
    refreshCards: syncEngine.refreshCards,
    refreshDecks: syncEngine.refreshDecks,
    refreshReviewQueue: syncEngine.refreshReviewQueue,
    getCardById: syncEngine.getCardById,
    getDeckById: syncEngine.getDeckById,
    createCardItem: syncEngine.createCardItem,
    createDeckItem: syncEngine.createDeckItem,
    updateCardItem: syncEngine.updateCardItem,
    updateDeckItem: syncEngine.updateDeckItem,
    deleteCardItem: syncEngine.deleteCardItem,
    deleteDeckItem: syncEngine.deleteDeckItem,
    selectReviewFilter,
    openReview,
    submitReviewItem: syncEngine.submitReviewItem,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const contextValue = useContext(AppDataContext);
  if (contextValue === null) {
    throw new Error("useAppData must be used within AppDataProvider");
  }

  return contextValue;
}
