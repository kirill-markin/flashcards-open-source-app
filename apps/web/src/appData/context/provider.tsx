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
import { useAppErrorDialog } from "../../appError/AppErrorContext";
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

function resolveTechnicalErrorAction(
  currentError: Error | null,
  nextErrorAction: SetStateAction<Error | null>,
): Error | null {
  return typeof nextErrorAction === "function" ? nextErrorAction(currentError) : nextErrorAction;
}

export function AppDataProvider(props: Props): ReactElement {
  const { children } = props;
  const { t } = useI18n();
  const { indexedDbOpenRecoveryState, showCapturedTechnicalError } = useAppErrorDialog();
  useProgressInvalidationRefresh();
  const [warmStartSnapshot] = useState(loadWarmStartSnapshot);
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>(
    warmStartSnapshot === null ? "loading" : "ready",
  );
  const [sessionVerificationState, setSessionVerificationState] = useState<SessionVerificationState>(
    "unverified",
  );
  const [sessionErrorMessage, setSessionErrorMessageState] = useState<string>("");
  const [sessionTechnicalError, setSessionTechnicalErrorState] = useState<Error | null>(null);
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
  const [technicalError, setTechnicalErrorState] = useState<Error | null>(null);
  const sessionTechnicalErrorRef = useRef<Error | null>(sessionTechnicalError);
  const technicalErrorRef = useRef<Error | null>(technicalError);
  const shownSessionTechnicalErrorRef = useRef<Error | null>(null);
  const shownGlobalTechnicalErrorRef = useRef<Error | null>(null);
  sessionTechnicalErrorRef.current = sessionTechnicalError;
  technicalErrorRef.current = technicalError;
  const accountPreferencesMutationVersionRef = useRef<number>(0);

  const setSessionTechnicalError = useCallback<Dispatch<SetStateAction<Error | null>>>((nextErrorAction): void => {
    const nextError = resolveTechnicalErrorAction(sessionTechnicalErrorRef.current, nextErrorAction);
    if (nextError !== null) {
      indexedDbOpenRecoveryState.markFailed(nextError);
    }
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    sessionTechnicalErrorRef.current = nextError;
    setSessionTechnicalErrorState(nextError);
  }, [indexedDbOpenRecoveryState]);

  const setTechnicalError = useCallback<Dispatch<SetStateAction<Error | null>>>((nextErrorAction): void => {
    const nextError = resolveTechnicalErrorAction(technicalErrorRef.current, nextErrorAction);
    if (nextError !== null) {
      indexedDbOpenRecoveryState.markFailed(nextError);
    }
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    technicalErrorRef.current = nextError;
    setTechnicalErrorState(nextError);
  }, [indexedDbOpenRecoveryState]);

  const setSessionErrorMessage = useCallback<Dispatch<SetStateAction<string>>>((nextMessageAction): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    setSessionTechnicalError(null);
    setSessionErrorMessageState(nextMessageAction);
  }, [indexedDbOpenRecoveryState, setSessionTechnicalError]);

  const setErrorMessage = useCallback<Dispatch<SetStateAction<string>>>((nextMessageAction): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    setTechnicalError(null);
    setErrorMessageState(nextMessageAction);
  }, [indexedDbOpenRecoveryState, setTechnicalError]);

  useEffect(() => {
    if (sessionLoadState !== "error" || sessionTechnicalError === null) {
      shownSessionTechnicalErrorRef.current = null;
      return;
    }

    if (shownSessionTechnicalErrorRef.current === sessionTechnicalError) {
      return;
    }

    shownSessionTechnicalErrorRef.current = sessionTechnicalError;
    showCapturedTechnicalError(sessionTechnicalError);
  }, [sessionLoadState, sessionTechnicalError, showCapturedTechnicalError]);

  useEffect(() => {
    if (errorMessage === "" || technicalError === null) {
      shownGlobalTechnicalErrorRef.current = null;
      return;
    }

    if (shownGlobalTechnicalErrorRef.current === technicalError) {
      return;
    }

    shownGlobalTechnicalErrorRef.current = technicalError;
    showCapturedTechnicalError(technicalError);
  }, [errorMessage, showCapturedTechnicalError, technicalError]);

  const syncEngine = useSyncEngine({
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    setWorkspaceSettings,
    setCloudSettings,
    setLocalReadVersion,
    setIsSyncing,
    setErrorMessage,
    setTechnicalError,
    indexedDbOpenRecoveryState,
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
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      if (activeWorkspace === null) {
        setLocalCardCount(0);
        return;
      }

      const cardCount = await loadActiveCardCount(activeWorkspace.workspaceId);
      if (isCancelled || indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      setLocalCardCount(cardCount);
    }

    void refreshLocalCardCount().catch((error: unknown): void => {
      indexedDbOpenRecoveryState.markFailed(error);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      throw error;
    });

    return () => {
      isCancelled = true;
    };
  }, [activeWorkspace, indexedDbOpenRecoveryState, localReadVersion]);

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
    indexedDbOpenRecoveryState,
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
