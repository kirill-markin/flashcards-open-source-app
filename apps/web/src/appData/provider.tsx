import {
  createContext,
  useContext,
  useState,
  type ReactElement,
} from "react";
import type {
  Card,
  Deck,
  SessionInfo,
  WorkspaceSummary,
} from "../types";
import { createIdleResourceState } from "./resourceState";
import type {
  AppDataContextValue,
  Props,
  SessionLoadState,
} from "./types";
import { useSyncEngine } from "./useSyncEngine";
import { useWorkspaceSession } from "./useWorkspaceSession";

const AppDataContext = createContext<AppDataContextValue | null>(null);

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
    cardsState,
    decksState,
    reviewQueueState,
    cards: cardsState.items,
    decks: decksState.items,
    reviewQueue: reviewQueueState.items,
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
    createCardItem: syncEngine.createCardItem,
    createDeckItem: syncEngine.createDeckItem,
    updateCardItem: syncEngine.updateCardItem,
    deleteCardItem: syncEngine.deleteCardItem,
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
