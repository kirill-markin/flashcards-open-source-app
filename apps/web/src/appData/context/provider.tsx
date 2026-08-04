import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import { revalidateSession } from "../../api";
import { useI18n } from "../../i18n";
import { loadActiveCardCount } from "../../localDb/cards/cards";
import type {
  AccountPreferences,
  CloudSettings,
  ReviewFilter,
  SessionInfo,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../../types";
import { ALL_CARDS_REVIEW_FILTER, isReviewFilterEqual, normalizeReviewFilter } from "../domain";
import type { AppDataContextValue, Props, SessionLoadState } from "./types";
import { useProgressInvalidationRefresh } from "../progress/invalidation/progressInvalidation";
import { isTestSeedBridgeEnabled, type AppDataTestSeedBridge } from "../sync/local/testSeedBridge";
import { useSyncEngine } from "../sync/engine/useSyncEngine";
import { useWorkspaceSession } from "../session/useWorkspaceSession";
import type { SessionVerificationState } from "../session/workspaceSessionTypes";
import { loadWarmStartSnapshot, storeWarmStartSnapshot } from "../session/activation/warmStart";
import {
  activateWorkspaceReviewFilterState,
  loadSelectedReviewFilterForWorkspace,
  storeSelectedReviewFilterForWorkspace,
  type WorkspaceReviewFilterState,
} from "./reviewFilterPersistence";

const AppDataContext = createContext<AppDataContextValue | null>(null);

function replaceSessionAccountPreferences(
  session: SessionInfo,
  preferences: AccountPreferences,
): SessionInfo {
  return {
    ...session,
    preferences,
  };
}

function mergeRefreshedAccountSession(
  previousSession: SessionInfo,
  refreshedSession: SessionInfo,
): SessionInfo {
  return {
    ...previousSession,
    selectedWorkspaceId: refreshedSession.selectedWorkspaceId,
    authTransport: refreshedSession.authTransport,
    csrfToken: refreshedSession.csrfToken,
    preferences: refreshedSession.preferences,
    profile: refreshedSession.profile,
  };
}

function mergeRefreshedAccountSessionWithoutPreferences(
  previousSession: SessionInfo,
  refreshedSession: SessionInfo,
): SessionInfo {
  return {
    ...previousSession,
    selectedWorkspaceId: refreshedSession.selectedWorkspaceId,
    authTransport: refreshedSession.authTransport,
    csrfToken: refreshedSession.csrfToken,
    profile: refreshedSession.profile,
  };
}

export function AppDataProvider(props: Props): ReactElement {
  const { children } = props;
  const { t } = useI18n();
  useProgressInvalidationRefresh();
  const [warmStartSnapshot] = useState(loadWarmStartSnapshot);
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>(
    warmStartSnapshot === null ? "loading" : "ready",
  );
  const [sessionVerificationState, setSessionVerificationState] = useState<SessionVerificationState>(
    "unverified",
  );
  const [sessionErrorMessage, setSessionErrorMessageState] = useState<string>("");
  const [sessionTechnicalError, setSessionTechnicalError] = useState<Error | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(warmStartSnapshot?.session ?? null);
  const [workspaceReviewFilterState, setWorkspaceReviewFilterState] = useState<WorkspaceReviewFilterState>(() => {
    const activeWorkspace = warmStartSnapshot?.activeWorkspace ?? null;
    const workspaceId = activeWorkspace?.workspaceId ?? null;
    return {
      activeWorkspace,
      selection: {
        workspaceId,
        reviewFilter: loadSelectedReviewFilterForWorkspace(workspaceId),
      },
    };
  });
  const workspaceReviewFilterStateRef = useRef<WorkspaceReviewFilterState>(workspaceReviewFilterState);
  workspaceReviewFilterStateRef.current = workspaceReviewFilterState;
  const activeWorkspace = workspaceReviewFilterState.activeWorkspace;
  const setActiveWorkspace = useCallback(function setActiveWorkspace(
    nextActiveWorkspace: WorkspaceSummary | null,
  ): void {
    const nextState = activateWorkspaceReviewFilterState(
      workspaceReviewFilterStateRef.current,
      nextActiveWorkspace,
      loadSelectedReviewFilterForWorkspace,
    );
    workspaceReviewFilterStateRef.current = nextState;
    setWorkspaceReviewFilterState(nextState);
  }, []);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>(
    warmStartSnapshot?.availableWorkspaces ?? [],
  );
  const [isChoosingWorkspace, setIsChoosingWorkspace] = useState<boolean>(false);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSchedulerSettings | null>(null);
  const [cloudSettings, setCloudSettings] = useState<CloudSettings | null>(null);
  const [localReadVersion, setLocalReadVersion] = useState<number>(0);
  const [localCardCount, setLocalCardCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessageState] = useState<string>("");
  const [technicalError, setTechnicalError] = useState<Error | null>(null);
  const accountPreferencesMutationVersionRef = useRef<number>(0);

  const setSessionErrorMessage = useCallback<Dispatch<SetStateAction<string>>>((nextMessageAction): void => {
    setSessionTechnicalError(null);
    setSessionErrorMessageState(nextMessageAction);
  }, []);

  const setErrorMessage = useCallback<Dispatch<SetStateAction<string>>>((nextMessageAction): void => {
    setTechnicalError(null);
    setErrorMessageState(nextMessageAction);
  }, []);

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
    setTechnicalError,
  });

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const selectedReviewFilterState = workspaceReviewFilterState.selection.reviewFilter;

  useEffect(() => {
    if (workspaceReviewFilterState.selection.workspaceId === null) {
      return;
    }

    storeSelectedReviewFilterForWorkspace(
      workspaceReviewFilterState.selection.workspaceId,
      workspaceReviewFilterState.selection.reviewFilter,
    );
  }, [workspaceReviewFilterState.selection]);

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

  useEffect(() => {
    if (
      isTestSeedBridgeEnabled(window) === false
      || sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || activeWorkspace === null
    ) {
      delete window.__FLASHCARDS_TEST_SEED_BRIDGE__;
      return;
    }

    const bridge: AppDataTestSeedBridge = {
      workspaceId: activeWorkspace.workspaceId,
      workspaceName: activeWorkspace.name,
      seedLinkedWorkspace: syncEngine.seedLinkedWorkspace,
    };

    window.__FLASHCARDS_TEST_SEED_BRIDGE__ = bridge;

    return () => {
      if (window.__FLASHCARDS_TEST_SEED_BRIDGE__ === bridge) {
        delete window.__FLASHCARDS_TEST_SEED_BRIDGE__;
      }
    };
  }, [
    activeWorkspace,
    sessionLoadState,
    sessionVerificationState,
    syncEngine.seedLinkedWorkspace,
  ]);

  const selectReviewFilter = useCallback(function selectReviewFilter(reviewFilter: ReviewFilter): void {
    if (activeWorkspaceId === null || isReviewFilterEqual(selectedReviewFilterState, reviewFilter)) {
      return;
    }

    setWorkspaceReviewFilterState((currentState): WorkspaceReviewFilterState => ({
      ...currentState,
      selection: {
        workspaceId: activeWorkspaceId,
        reviewFilter: normalizeReviewFilter(reviewFilter),
      },
    }));
  }, [activeWorkspaceId, selectedReviewFilterState]);

  const resetUserScopedUiState = useCallback(function resetUserScopedUiState(): void {
    setWorkspaceReviewFilterState((currentState): WorkspaceReviewFilterState => ({
      ...currentState,
      selection: {
        workspaceId: currentState.activeWorkspace?.workspaceId ?? null,
        reviewFilter: ALL_CARDS_REVIEW_FILTER,
      },
    }));
    setWorkspaceSettings(null);
    setLocalReadVersion(0);
    setLocalCardCount(0);
    setIsSyncing(false);
  }, []);

  const openReview = useCallback(function openReview(reviewFilter: ReviewFilter): void {
    if (activeWorkspaceId === null) {
      return;
    }

    setWorkspaceReviewFilterState((currentState): WorkspaceReviewFilterState => ({
      ...currentState,
      selection: {
        workspaceId: activeWorkspaceId,
        reviewFilter: normalizeReviewFilter(reviewFilter),
      },
    }));
  }, [activeWorkspaceId]);

  const setAccountPreferences = useCallback(function setAccountPreferences(
    userId: string,
    preferences: AccountPreferences,
  ): void {
    accountPreferencesMutationVersionRef.current += 1;
    setSession((currentSession): SessionInfo | null => {
      if (currentSession === null || currentSession.userId !== userId) {
        return currentSession;
      }

      return replaceSessionAccountPreferences(currentSession, preferences);
    });
  }, []);

  const refreshAccountPreferences = useCallback(async function refreshAccountPreferences(): Promise<AccountPreferences> {
    const sessionUserId = session?.userId ?? null;
    if (sessionUserId === null) {
      throw new Error(t("app.sessionUnavailable"));
    }

    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified") {
      throw new Error(t("app.sessionRestoringActionLocked"));
    }

    const refreshStartedAtMutationVersion = accountPreferencesMutationVersionRef.current;
    const refreshedSession = await revalidateSession();
    if (refreshedSession.userId !== sessionUserId) {
      throw new Error(t("app.sessionUnavailable"));
    }

    setSession((currentSession): SessionInfo | null => {
      if (currentSession === null || currentSession.userId !== refreshedSession.userId) {
        return currentSession;
      }

      if (refreshStartedAtMutationVersion !== accountPreferencesMutationVersionRef.current) {
        return mergeRefreshedAccountSessionWithoutPreferences(currentSession, refreshedSession);
      }

      return mergeRefreshedAccountSession(currentSession, refreshedSession);
    });
    setSessionErrorMessage("");
    setErrorMessage("");
    return refreshedSession.preferences;
  }, [
    session?.userId,
    sessionLoadState,
    sessionVerificationState,
    t,
    setErrorMessage,
    setSessionErrorMessage,
  ]);

  const {
    initialize,
    chooseWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    loadWorkspaceResetProgressPreview,
    resetWorkspaceProgress,
  } = useWorkspaceSession({
    t,
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    setSessionLoadState,
    setSessionVerificationState,
    setSessionErrorMessage,
    setSessionTechnicalError,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
    setTechnicalError,
    setCloudSettings,
    refreshWorkspaceView: syncEngine.refreshWorkspaceView,
    runSync: syncEngine.runSync,
    runSyncSilently: syncEngine.runSyncSilently,
    runSyncForWorkspace: syncEngine.runSyncForWorkspace,
    discardWorkspaceSync: syncEngine.discardWorkspaceSync,
    discardAllSyncWork: syncEngine.discardAllSyncWork,
    resetUserScopedUiState,
  });

  const value: AppDataContextValue = {
    sessionLoadState,
    sessionVerificationState,
    isSessionVerified: sessionVerificationState === "verified",
    sessionErrorMessage,
    sessionTechnicalError,
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
    technicalError,
    setErrorMessage,
    setAccountPreferences,
    refreshAccountPreferences,
    initialize,
    chooseWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    loadWorkspaceResetProgressPreview,
    resetWorkspaceProgress,
    runSync: syncEngine.runSync,
    runMediaUploadTransfers: syncEngine.runMediaUploadTransfers,
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

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

export function useAppData(): AppDataContextValue {
  const contextValue = useContext(AppDataContext);
  if (contextValue === null) {
    throw new Error("useAppData must be used within AppDataProvider");
  }

  return contextValue;
}
