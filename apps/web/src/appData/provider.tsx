import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { loadActiveCardCount } from "../localDb/cards";
import type { CloudSettings, ReviewFilter, SessionInfo, WorkspaceSchedulerSettings, WorkspaceSummary } from "../types";
import { ALL_CARDS_REVIEW_FILTER, isReviewFilterEqual } from "./domain";
import type { AppDataContextValue, Props, SessionLoadState } from "./types";
import { useSyncEngine } from "./useSyncEngine";
import { useWorkspaceSession } from "./useWorkspaceSession";
import type { SessionVerificationState } from "./warmStart";
import { loadWarmStartSnapshot, storeWarmStartSnapshot } from "./warmStart";

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
  const [warmStartSnapshot] = useState(loadWarmStartSnapshot);
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>(
    warmStartSnapshot === null ? "loading" : "ready",
  );
  const [sessionVerificationState, setSessionVerificationState] = useState<SessionVerificationState>(
    "unverified",
  );
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string>("");
  const [session, setSession] = useState<SessionInfo | null>(warmStartSnapshot?.session ?? null);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(warmStartSnapshot?.activeWorkspace ?? null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>(
    warmStartSnapshot?.availableWorkspaces ?? [],
  );
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
    sessionVerificationState,
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
    if (
      sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || session === null
      || activeWorkspace === null
      || availableWorkspaces.length === 0
    ) {
      return;
    }

    storeWarmStartSnapshot({
      version: 1,
      session,
      activeWorkspace,
      availableWorkspaces,
      savedAt: new Date().toISOString(),
    });
  }, [activeWorkspace, availableWorkspaces, session, sessionLoadState, sessionVerificationState]);

  useEffect(() => {
    let isCancelled = false;

    async function refreshLocalCardCount(): Promise<void> {
      if (activeWorkspace === null) {
        setLocalCardCount(0);
        return;
      }

      const cardCount = await loadActiveCardCount(activeWorkspace.workspaceId);
      if (isCancelled) {
        return;
      }

      setLocalCardCount(cardCount);
    }

    void refreshLocalCardCount();

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, localReadVersion]);

  const selectReviewFilter = useCallback(function selectReviewFilter(reviewFilter: ReviewFilter): void {
    if (isReviewFilterEqual(selectedReviewFilterState, reviewFilter)) {
      return;
    }

    setSelectedReviewFilterState(reviewFilter);
  }, [selectedReviewFilterState]);

  const openReview = useCallback(function openReview(reviewFilter: ReviewFilter): void {
    setSelectedReviewFilterState(reviewFilter);
  }, []);

  const { initialize, chooseWorkspace, createWorkspace, renameWorkspace, deleteWorkspace } = useWorkspaceSession({
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    setSessionLoadState,
    setSessionVerificationState,
    setSessionErrorMessage,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
    setCloudSettings,
    refreshWorkspaceView: syncEngine.refreshWorkspaceView,
    runSync: syncEngine.runSync,
    runSyncSilently: syncEngine.runSyncSilently,
    runSyncForWorkspace: syncEngine.runSyncForWorkspace,
  });

  const value: AppDataContextValue = {
    sessionLoadState,
    sessionVerificationState,
    isSessionVerified: sessionVerificationState === "verified",
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
    renameWorkspace,
    deleteWorkspace,
    runSync: syncEngine.runSync,
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
