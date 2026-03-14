import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { loadActiveCardCount } from "../syncStorage";
import type { CloudSettings, ReviewFilter, SessionInfo, WorkspaceSchedulerSettings, WorkspaceSummary } from "../types";
import { ALL_CARDS_REVIEW_FILTER, isReviewFilterEqual } from "./domain";
import type { AppDataContextValue, Props, SessionLoadState } from "./types";
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
      && parsedValue.kind === "tag"
      && "tag" in parsedValue
      && typeof parsedValue.tag === "string"
      && parsedValue.tag !== ""
    ) {
      return {
        kind: "tag",
        tag: parsedValue.tag,
      };
    }

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
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSchedulerSettings | null>(null);
  const [cloudSettings, setCloudSettings] = useState<CloudSettings | null>(null);
  const [localReadVersion, setLocalReadVersion] = useState<number>(0);
  const [localCardCount, setLocalCardCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [selectedReviewFilterState, setSelectedReviewFilterState] = useState<ReviewFilter>(loadSelectedReviewFilter);

  const syncEngine = useSyncEngine({
    sessionLoadState,
    session,
    activeWorkspace,
    setWorkspaceSettings,
    setCloudSettings,
    setLocalReadVersion,
    setIsSyncing,
    setErrorMessage,
  });

  useEffect(() => {
    window.localStorage.setItem(SELECTED_REVIEW_FILTER_STORAGE_KEY, JSON.stringify(selectedReviewFilterState));
  }, [selectedReviewFilterState]);

  useEffect(() => {
    let isCancelled = false;

    async function refreshLocalCardCount(): Promise<void> {
      const cardCount = await loadActiveCardCount();
      if (isCancelled) {
        return;
      }

      setLocalCardCount(cardCount);
    }

    void refreshLocalCardCount();

    return () => {
      isCancelled = true;
    };
  }, [localReadVersion]);

  const selectReviewFilter = useCallback(function selectReviewFilter(reviewFilter: ReviewFilter): void {
    if (isReviewFilterEqual(selectedReviewFilterState, reviewFilter)) {
      return;
    }

    setSelectedReviewFilterState(reviewFilter);
  }, [selectedReviewFilterState]);

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
    setErrorMessage,
    setCloudSettings,
    refreshLocalData: syncEngine.refreshLocalData,
    runSync: syncEngine.runSync,
  });

  const value: AppDataContextValue = {
    sessionLoadState,
    sessionErrorMessage,
    session,
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
    workspaceSettings,
    cloudSettings,
    localReadVersion,
    localCardCount,
    isSyncing,
    selectedReviewFilter: selectedReviewFilterState,
    errorMessage,
    setErrorMessage,
    initialize,
    chooseWorkspace,
    createWorkspace,
    refreshLocalData: syncEngine.refreshLocalData,
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
