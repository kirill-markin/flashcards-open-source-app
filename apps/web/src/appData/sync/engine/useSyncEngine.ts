import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  isAuthRedirectError,
} from "../../../api";
import {
  isIndexedDbOpenRecoveryFailureMark,
  type IndexedDbOpenRecoveryMarkResult,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import {
  loadCloudSettings,
} from "../../../localDb/sync/cloudSettings";
import {
  loadNextPendingMediaTransferAttemptAtByKind,
} from "../../../localDb/mediaTransfers";
import {
  loadWorkspaceSettings,
} from "../../../localDb/cards/workspace";
import type {
  Card,
  CloudSettings,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  SessionInfo,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../../../types";
import {
  normalizeCaughtError,
} from "../../../observability/webObservability";
import {
  captureAppOperationError,
} from "../../../observability/appOperationObservation";
import {
  getErrorMessage,
  nowIso,
} from "../../domain";
import {
  invalidateLocalProgress,
  invalidateLocalReviewSchedule,
  invalidateProgress,
} from "../../progress/invalidation/progressInvalidation";
import {
  getBrowserTimeZone,
} from "../../../progress/progressDates";
import {
  requireCloudInstallationId,
} from "../local/syncCloudSettings";
import {
  attachSyncFailureObservation,
  createWorkspaceSyncDiscardedError,
  isWorkspaceNotFoundError,
  isWorkspaceSyncDiscardedError,
  observeSyncFailure,
} from "../observation/syncErrorObservation";
import {
  createCardLocally,
  createDeckLocally,
  deleteCardLocally,
  deleteDeckLocally,
  requireCard,
  requireDeck,
  submitReviewLocally,
  updateCardLocally,
  updateDeckLocally,
} from "../local/syncLocalMutations";
import {
  runWorkspaceRemoteSync,
} from "../remote/syncRemote";
import {
  processDueMediaUploadTransfersForWorkspace,
} from "../mediaUploads/mediaUploadTransferRunner";
import {
  ensureWorkspaceSeedReady,
  seedWorkspaceLocally,
  validateSeedRequest,
} from "../local/syncSeed";
import type { TestSeedRequest, TestSeedResult } from "../local/testSeedBridge";
import type { SessionLoadState } from "../../context/types";
import type { SessionVerificationState } from "../../session/workspaceSessionTypes";

type UseSyncEngineParams = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  setWorkspaceSettings: Dispatch<SetStateAction<WorkspaceSchedulerSettings | null>>;
  setCloudSettings: Dispatch<SetStateAction<CloudSettings | null>>;
  setLocalReadVersion: Dispatch<SetStateAction<number>>;
  setIsSyncing: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
  setTechnicalError: Dispatch<SetStateAction<Error | null>>;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
}>;

type SyncEngine = Readonly<{
  runSync: () => Promise<void>;
  runSyncSilently: () => Promise<void>;
  runSyncForWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
  runMediaUploadTransfers: () => void;
  discardWorkspaceSync: (workspaceId: string) => void;
  discardAllSyncWork: (runWhileDiscarding: () => Promise<void>) => Promise<void>;
  refreshLocalData: () => Promise<void>;
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
  getCardById: (cardId: string) => Promise<Card>;
  getDeckById: (deckId: string) => Promise<Deck>;
  createCardItem: (input: CreateCardInput) => Promise<Card>;
  createDeckItem: (input: CreateDeckInput) => Promise<Deck>;
  updateCardItem: (cardId: string, input: UpdateCardInput) => Promise<Card>;
  updateDeckItem: (deckId: string, input: UpdateDeckInput) => Promise<Deck>;
  deleteCardItem: (cardId: string) => Promise<Card>;
  deleteDeckItem: (deckId: string) => Promise<Deck>;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
  seedLinkedWorkspace: (request: TestSeedRequest) => Promise<TestSeedResult>;
}>;

type SyncFailureReport = Readonly<{
  error: Error;
  wasCaptured: boolean;
}>;

const maximumMediaUploadRetryTimerDelayMs = 2_147_483_647;

function createSyncRunId(): string {
  const cryptoValue = globalThis.crypto;
  if (typeof cryptoValue?.randomUUID === "function") {
    return cryptoValue.randomUUID();
  }

  return `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Background sync is fire-and-forget from effects and mutations. Failures are
// already observed (observeSyncFailure) and surfaced (reportSyncError) inside
// runSyncForWorkspace before it rethrows for awaited callers, so here we attach
// a no-op catch only to keep the fire-and-forget promise from surfacing as a
// context-less unhandled rejection (for example "Failed to open IndexedDB" when
// the browser blocks local storage).
function runSyncInBackground(syncTask: Promise<void>): void {
  void syncTask.catch((): void => undefined);
}

function calculateMediaUploadRetryTimerDelayMs(nextAttemptAt: string, nowMs: number): number | null {
  const nextAttemptTime = Date.parse(nextAttemptAt);
  if (Number.isFinite(nextAttemptTime) === false) {
    throw new Error(`Media upload retry scheduling failed: invalid nextAttemptAt=${nextAttemptAt}`);
  }

  const delayMs = Math.max(0, nextAttemptTime - nowMs);
  return delayMs > maximumMediaUploadRetryTimerDelayMs ? null : delayMs;
}

// A brand-new user owns exactly one workspace, the one created for the account at sign-up.
// Creating a further workspace never removes the earlier ones, so an account that still has
// a single workspace is the only user-scoped signal remote sync needs to tell a new user
// apart from an existing user who deliberately created another empty workspace.
function isOnlyWorkspaceOfAccount(
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>,
  workspaceId: string,
): boolean {
  return availableWorkspaces.length === 1 && availableWorkspaces[0].workspaceId === workspaceId;
}

function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function isLinkedMediaUploadCloudSettings(
  cloudSettings: CloudSettings | null,
  session: SessionInfo,
  workspaceId: string,
): boolean {
  return cloudSettings !== null
    && cloudSettings.cloudState === "linked"
    && cloudSettings.linkedUserId === session.userId
    && cloudSettings.linkedWorkspaceId === workspaceId
    && cloudSettings.installationId.trim() !== "";
}

function runMediaUploadTransfersInBackground(
  mediaUploadTask: Promise<void>,
  reportError: (error: unknown) => void,
): void {
  void mediaUploadTask.catch(reportError);
}

export function useSyncEngine(params: UseSyncEngineParams): SyncEngine {
  const {
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
  } = params;
  const activeWorkspaceRef = useRef<WorkspaceSummary | null>(activeWorkspace);
  const availableWorkspacesRef = useRef<ReadonlyArray<WorkspaceSummary>>(availableWorkspaces);
  const syncPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const syncAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const workspaceSyncGenerationsRef = useRef<Map<string, number>>(new Map());
  const localReadPromisesRef = useRef<Set<Promise<unknown>>>(new Set());
  const localMutationPromisesRef = useRef<Set<Promise<unknown>>>(new Set());
  const mediaUploadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const mediaUploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const mediaUploadNeedsRunWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const mediaUploadRetryTimerIdsRef = useRef<Map<string, number>>(new Map());
  const runMediaUploadTransfersForWorkspaceRef = useRef<(workspace: WorkspaceSummary) => void>(() => undefined);
  const isSyncEngineMountedRef = useRef<boolean>(true);
  const mediaUploadLifecycleGenerationRef = useRef<number>(0);
  const sessionLoadStateRef = useRef<SessionLoadState>(sessionLoadState);
  const sessionRef = useRef<SessionInfo | null>(session);
  const sessionVerificationStateRef = useRef<SessionVerificationState>(sessionVerificationState);
  const needsResyncWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const syncingWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const discardedSyncWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const syncGenerationRef = useRef<number>(0);
  const isDiscardingAllSyncWorkRef = useRef<boolean>(false);
  const discardAllSyncWorkPromiseRef = useRef<Promise<void> | null>(null);
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  // Mirrored during render, not in an effect: workspace activation publishes the new
  // workspace list and starts the sync run for the new workspace in the same tick, and the
  // run must not decide "only workspace of the account" from the pre-creation list.
  availableWorkspacesRef.current = availableWorkspaces;

  useEffect(() => {
    sessionLoadStateRef.current = sessionLoadState;
    sessionRef.current = session;
    sessionVerificationStateRef.current = sessionVerificationState;
  }, [session, sessionLoadState, sessionVerificationState]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
    setIsSyncing(activeWorkspace !== null && syncingWorkspaceIdsRef.current.has(activeWorkspace.workspaceId));
  }, [activeWorkspace, setIsSyncing]);

  const bumpLocalReadVersion = useCallback(function bumpLocalReadVersion(): void {
    setLocalReadVersion((currentValue) => currentValue + 1);
  }, [setLocalReadVersion]);

  const isVisibleWorkspace = useCallback(function isVisibleWorkspace(workspaceId: string): boolean {
    return activeWorkspaceRef.current?.workspaceId === workspaceId;
  }, []);

  const refreshSyncIndicator = useCallback(function refreshSyncIndicator(): void {
    const currentWorkspace = activeWorkspaceRef.current;
    setIsSyncing(currentWorkspace !== null && syncingWorkspaceIdsRef.current.has(currentWorkspace.workspaceId));
  }, [setIsSyncing]);

  const clearMediaUploadRetryTimer = useCallback(function clearMediaUploadRetryTimer(workspaceId: string): void {
    const timerId = mediaUploadRetryTimerIdsRef.current.get(workspaceId);
    if (timerId === undefined) {
      return;
    }

    window.clearTimeout(timerId);
    mediaUploadRetryTimerIdsRef.current.delete(workspaceId);
  }, []);

  const clearAllMediaUploadRetryTimers = useCallback(function clearAllMediaUploadRetryTimers(): void {
    for (const timerId of mediaUploadRetryTimerIdsRef.current.values()) {
      window.clearTimeout(timerId);
    }

    mediaUploadRetryTimerIdsRef.current.clear();
  }, []);

  const markIndexedDbOpenRecoveryFailure = useCallback(function markIndexedDbOpenRecoveryFailure(
    error: unknown,
  ): IndexedDbOpenRecoveryMarkResult {
    const markResult = indexedDbOpenRecoveryState.markFailed(error);
    if (isIndexedDbOpenRecoveryFailureMark(markResult) === false) {
      return markResult;
    }

    needsResyncWorkspaceIdsRef.current.clear();
    mediaUploadNeedsRunWorkspaceIdsRef.current.clear();
    clearAllMediaUploadRetryTimers();
    return markResult;
  }, [clearAllMediaUploadRetryTimers, indexedDbOpenRecoveryState]);

  const waitForRecoveryGuardedSyncPhase = useCallback(async function waitForRecoveryGuardedSyncPhase<ResultType>(
    phase: Promise<ResultType>,
  ): Promise<ResultType> {
    try {
      const result = await phase;
      indexedDbOpenRecoveryState.throwIfFailed();
      return result;
    } catch (error) {
      indexedDbOpenRecoveryState.throwIfFailed();
      markIndexedDbOpenRecoveryFailure(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      throw error;
    }
  }, [indexedDbOpenRecoveryState, markIndexedDbOpenRecoveryFailure]);

  const abortAllMediaUploadTransfers = useCallback(function abortAllMediaUploadTransfers(): void {
    for (const controller of mediaUploadAbortControllersRef.current.values()) {
      controller.abort(new Error("Media upload lifecycle was discarded"));
    }
    mediaUploadAbortControllersRef.current.clear();
  }, []);

  const abortWorkspaceRemoteSync = useCallback(function abortWorkspaceRemoteSync(
    workspaceId: string,
    reason: Error,
  ): void {
    const controller = syncAbortControllersRef.current.get(workspaceId);
    if (controller === undefined) {
      return;
    }

    controller.abort(reason);
    syncAbortControllersRef.current.delete(workspaceId);
  }, []);

  const abortAllWorkspaceRemoteSyncs = useCallback(function abortAllWorkspaceRemoteSyncs(
    reason: Error,
  ): void {
    for (const controller of syncAbortControllersRef.current.values()) {
      controller.abort(reason);
    }
    syncAbortControllersRef.current.clear();
  }, []);

  useEffect(() => {
    if (indexedDbOpenRecoveryState.isFailed === false) {
      return;
    }

    let recoveryError: Error;
    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      return;
    } catch (error) {
      if (error instanceof Error === false) {
        throw error;
      }
      recoveryError = error;
    }

    syncGenerationRef.current += 1;
    abortAllWorkspaceRemoteSyncs(recoveryError);
    syncPromisesRef.current.clear();
    syncingWorkspaceIdsRef.current.clear();
    abortAllMediaUploadTransfers();
    mediaUploadLifecycleGenerationRef.current += 1;
    mediaUploadNeedsRunWorkspaceIdsRef.current.clear();
    clearAllMediaUploadRetryTimers();
    needsResyncWorkspaceIdsRef.current.clear();
  }, [
    abortAllMediaUploadTransfers,
    abortAllWorkspaceRemoteSyncs,
    clearAllMediaUploadRetryTimers,
    indexedDbOpenRecoveryState,
  ]);

  const discardWorkspaceSync = useCallback(function discardWorkspaceSync(workspaceId: string): void {
    discardedSyncWorkspaceIdsRef.current.add(workspaceId);
    workspaceSyncGenerationsRef.current.set(
      workspaceId,
      (workspaceSyncGenerationsRef.current.get(workspaceId) ?? 0) + 1,
    );
    abortWorkspaceRemoteSync(
      workspaceId,
      new Error(`Workspace remote sync was discarded: workspaceId=${workspaceId}`),
    );
    syncPromisesRef.current.delete(workspaceId);
    mediaUploadAbortControllersRef.current.get(workspaceId)?.abort(
      new Error(`Media upload workspace lifecycle was discarded: workspaceId=${workspaceId}`),
    );
    clearMediaUploadRetryTimer(workspaceId);
    mediaUploadNeedsRunWorkspaceIdsRef.current.delete(workspaceId);
    needsResyncWorkspaceIdsRef.current.delete(workspaceId);
    syncingWorkspaceIdsRef.current.delete(workspaceId);
    refreshSyncIndicator();
  }, [abortWorkspaceRemoteSync, clearMediaUploadRetryTimer, refreshSyncIndicator]);

  const discardAllSyncWork = useCallback(async function discardAllSyncWork(
    runWhileDiscarding: () => Promise<void>,
  ): Promise<void> {
    const activeDiscard = discardAllSyncWorkPromiseRef.current;
    if (activeDiscard !== null) {
      return waitForRecoveryGuardedSyncPhase(activeDiscard);
    }

    const discardTask = (async (): Promise<void> => {
      isDiscardingAllSyncWorkRef.current = true;
      const activeSyncTasks = [...syncPromisesRef.current.values()];
      const activeLocalReadTasks = [...localReadPromisesRef.current.values()];
      const activeLocalMutationTasks = [...localMutationPromisesRef.current.values()];
      const activeMediaUploadTasks = [...mediaUploadPromisesRef.current.values()];
      syncGenerationRef.current += 1;
      abortAllWorkspaceRemoteSyncs(new Error("All workspace remote sync work was discarded"));
      abortAllMediaUploadTransfers();
      mediaUploadLifecycleGenerationRef.current += 1;
      syncPromisesRef.current.clear();
      mediaUploadPromisesRef.current.clear();
      mediaUploadNeedsRunWorkspaceIdsRef.current.clear();
      clearAllMediaUploadRetryTimers();
      needsResyncWorkspaceIdsRef.current.clear();
      syncingWorkspaceIdsRef.current.clear();
      discardedSyncWorkspaceIdsRef.current.clear();
      refreshSyncIndicator();

      try {
        await waitForRecoveryGuardedSyncPhase(Promise.allSettled([
          ...activeSyncTasks,
          ...activeLocalReadTasks,
          ...activeLocalMutationTasks,
          ...activeMediaUploadTasks,
        ]));
        await waitForRecoveryGuardedSyncPhase(runWhileDiscarding());
      } finally {
        discardAllSyncWorkPromiseRef.current = null;
        isDiscardingAllSyncWorkRef.current = false;
      }
    })();
    discardAllSyncWorkPromiseRef.current = discardTask;
    return discardTask;
  }, [abortAllMediaUploadTransfers, abortAllWorkspaceRemoteSyncs, clearAllMediaUploadRetryTimers, refreshSyncIndicator, waitForRecoveryGuardedSyncPhase]);

  const isCurrentWorkspaceSync = useCallback(function isCurrentWorkspaceSync(
    workspaceId: string,
    syncGeneration: number,
    workspaceSyncGeneration: number,
  ): boolean {
    return syncGeneration === syncGenerationRef.current
      && workspaceSyncGeneration === (workspaceSyncGenerationsRef.current.get(workspaceId) ?? 0);
  }, []);

  const requireWorkspaceSyncNotDiscarded = useCallback(function requireWorkspaceSyncNotDiscarded(
    workspaceId: string,
    syncGeneration: number,
    workspaceSyncGeneration: number,
  ): void {
    if (
      isCurrentWorkspaceSync(workspaceId, syncGeneration, workspaceSyncGeneration) === false
      || discardedSyncWorkspaceIdsRef.current.has(workspaceId)
    ) {
      throw createWorkspaceSyncDiscardedError(workspaceId);
    }
  }, [isCurrentWorkspaceSync]);

  const isStaleWorkspaceNotFoundError = useCallback(function isStaleWorkspaceNotFoundError(
    workspaceId: string,
    error: unknown,
  ): boolean {
    return isWorkspaceNotFoundError(error) && isVisibleWorkspace(workspaceId) === false;
  }, [isVisibleWorkspace]);

  const runLocalDataRead = useCallback(function runLocalDataRead<ResultType>(
    createReadTask: () => Promise<ResultType>,
  ): Promise<ResultType> {
    if (isDiscardingAllSyncWorkRef.current) {
      throw new Error("Workspace is unavailable");
    }

    indexedDbOpenRecoveryState.throwIfFailed();
    let readTask: Promise<ResultType>;
    try {
      readTask = createReadTask();
    } catch (error) {
      markIndexedDbOpenRecoveryFailure(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      throw error;
    }
    const guardedReadTask = readTask.then(
      (result: ResultType): ResultType => {
        indexedDbOpenRecoveryState.throwIfFailed();
        return result;
      },
      (error: unknown): never => {
        markIndexedDbOpenRecoveryFailure(error);
        indexedDbOpenRecoveryState.throwIfFailed();
        throw error;
      },
    );
    const trackedReadTask = guardedReadTask.finally(() => {
      localReadPromisesRef.current.delete(trackedReadTask);
    });
    localReadPromisesRef.current.add(trackedReadTask);
    return trackedReadTask;
  }, [indexedDbOpenRecoveryState, markIndexedDbOpenRecoveryFailure]);

  const refreshLocalMetadata = useCallback(async function refreshLocalMetadata(workspaceId: string): Promise<void> {
    if (isDiscardingAllSyncWorkRef.current || indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const metadataGeneration = syncGenerationRef.current;
    const [workspaceSettings, cloudSettings] = await runLocalDataRead(() => Promise.all([
      waitForRecoveryGuardedSyncPhase(loadWorkspaceSettings(workspaceId)),
      waitForRecoveryGuardedSyncPhase(loadCloudSettings()),
    ])).catch((error: unknown): never => {
      const normalizedError = normalizeCaughtError(error);
      if (isIndexedDbOpenRecoveryFailureMark(markIndexedDbOpenRecoveryFailure(normalizedError))) {
        throw normalizedError;
      }

      throw error;
    });
    if (
      metadataGeneration !== syncGenerationRef.current
      || isDiscardingAllSyncWorkRef.current
      || indexedDbOpenRecoveryState.hasFailed()
    ) {
      return;
    }

    setCloudSettings(cloudSettings);
    if (isVisibleWorkspace(workspaceId)) {
      setWorkspaceSettings(workspaceSettings);
    }
  }, [indexedDbOpenRecoveryState, isVisibleWorkspace, markIndexedDbOpenRecoveryFailure, runLocalDataRead, setCloudSettings, setWorkspaceSettings, waitForRecoveryGuardedSyncPhase]);

  const refreshWorkspaceView = useCallback(async function refreshWorkspaceView(workspaceId: string): Promise<void> {
    const metadataGeneration = syncGenerationRef.current;
    await waitForRecoveryGuardedSyncPhase(refreshLocalMetadata(workspaceId));
    if (
      metadataGeneration !== syncGenerationRef.current
      || indexedDbOpenRecoveryState.hasFailed()
    ) {
      return;
    }

    if (isVisibleWorkspace(workspaceId)) {
      bumpLocalReadVersion();
    }
  }, [bumpLocalReadVersion, indexedDbOpenRecoveryState, isVisibleWorkspace, refreshLocalMetadata, waitForRecoveryGuardedSyncPhase]);

  const publishWorkspaceSettings = useCallback(function publishWorkspaceSettings(
    workspaceId: string,
    workspaceSettings: WorkspaceSchedulerSettings,
  ): void {
    if (isVisibleWorkspace(workspaceId)) {
      setWorkspaceSettings(workspaceSettings);
    }
  }, [isVisibleWorkspace, setWorkspaceSettings]);

  const reportGlobalSyncError = useCallback(function reportGlobalSyncError(report: SyncFailureReport): void {
    markIndexedDbOpenRecoveryFailure(report.error);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    setErrorMessage(getErrorMessage(report.error));
    if (report.wasCaptured) {
      setTechnicalError(report.error);
    } else {
      setTechnicalError(null);
    }
  }, [indexedDbOpenRecoveryState, markIndexedDbOpenRecoveryFailure, setErrorMessage, setTechnicalError]);

  const ignoreSyncError = useCallback(function ignoreSyncError(_report: SyncFailureReport): void {
  }, []);

  const reportMediaUploadError = useCallback(function reportMediaUploadError(
    error: unknown,
    userId: string,
    workspaceId: string,
  ): void {
    const normalizedError = normalizeCaughtError(error);
    markIndexedDbOpenRecoveryFailure(normalizedError);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    captureAppOperationError(normalizedError, {
      feature: "sync",
      operation: "media_upload_transfers",
      userId,
      workspaceId,
      installationId: null,
      entityId: null,
    });
  }, [indexedDbOpenRecoveryState, markIndexedDbOpenRecoveryFailure]);

  const readCurrentRunnableMediaUploadSession = useCallback(function readCurrentRunnableMediaUploadSession(
    workspace: WorkspaceSummary,
  ): SessionInfo | null {
    const currentSession = sessionRef.current;
    if (
      isDiscardingAllSyncWorkRef.current
      || indexedDbOpenRecoveryState.hasFailed()
      || isSyncEngineMountedRef.current === false
      || sessionLoadStateRef.current !== "ready"
      || currentSession === null
      || sessionVerificationStateRef.current !== "verified"
      || isBrowserOnline() === false
      || activeWorkspaceRef.current?.workspaceId !== workspace.workspaceId
      || discardedSyncWorkspaceIdsRef.current.has(workspace.workspaceId)
    ) {
      return null;
    }

    return currentSession;
  }, [indexedDbOpenRecoveryState]);

  const loadRunnableMediaUploadSession = useCallback(async function loadRunnableMediaUploadSession(
    workspace: WorkspaceSummary,
  ): Promise<SessionInfo | null> {
    const currentSession = readCurrentRunnableMediaUploadSession(workspace);
    if (currentSession === null) {
      return null;
    }

    const cloudSettings = await waitForRecoveryGuardedSyncPhase(loadCloudSettings());
    const verifiedSession = readCurrentRunnableMediaUploadSession(workspace);
    if (
      verifiedSession === null
      || isLinkedMediaUploadCloudSettings(cloudSettings, verifiedSession, workspace.workspaceId) === false
    ) {
      return null;
    }

    return verifiedSession;
  }, [readCurrentRunnableMediaUploadSession, waitForRecoveryGuardedSyncPhase]);

  const scheduleMediaUploadRetryTimerForWorkspace = useCallback(async function scheduleMediaUploadRetryTimerForWorkspace(
    workspace: WorkspaceSummary,
  ): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const mediaUploadLifecycleGeneration = mediaUploadLifecycleGenerationRef.current;
    if (await waitForRecoveryGuardedSyncPhase(loadRunnableMediaUploadSession(workspace)) === null) {
      return;
    }

    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const nextAttemptAt = await waitForRecoveryGuardedSyncPhase(
      loadNextPendingMediaTransferAttemptAtByKind(
        workspace.workspaceId,
        "upload",
        indexedDbOpenRecoveryState,
      ),
    );
    const runnableSession = await waitForRecoveryGuardedSyncPhase(loadRunnableMediaUploadSession(workspace));
    if (
      mediaUploadLifecycleGeneration !== mediaUploadLifecycleGenerationRef.current
      || indexedDbOpenRecoveryState.hasFailed()
      || nextAttemptAt === null
      || runnableSession === null
    ) {
      return;
    }

    const delayMs = calculateMediaUploadRetryTimerDelayMs(nextAttemptAt, Date.now());
    if (delayMs === null) {
      return;
    }

    clearMediaUploadRetryTimer(workspace.workspaceId);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const timerId = window.setTimeout((): void => {
      if (mediaUploadLifecycleGeneration !== mediaUploadLifecycleGenerationRef.current) {
        return;
      }

      mediaUploadRetryTimerIdsRef.current.delete(workspace.workspaceId);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      runMediaUploadTransfersForWorkspaceRef.current(workspace);
    }, delayMs);
    mediaUploadRetryTimerIdsRef.current.set(workspace.workspaceId, timerId);
  }, [clearMediaUploadRetryTimer, indexedDbOpenRecoveryState, loadRunnableMediaUploadSession, waitForRecoveryGuardedSyncPhase]);

  const runMediaUploadTransfersForWorkspace = useCallback(function runMediaUploadTransfersForWorkspace(
    workspace: WorkspaceSummary,
  ): void {
    clearMediaUploadRetryTimer(workspace.workspaceId);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const currentSession = readCurrentRunnableMediaUploadSession(workspace);
    if (currentSession === null) {
      return;
    }

    const activeMediaUploadTask = mediaUploadPromisesRef.current.get(workspace.workspaceId);
    if (activeMediaUploadTask !== undefined) {
      mediaUploadNeedsRunWorkspaceIdsRef.current.add(workspace.workspaceId);
      return;
    }

    const mediaUploadLifecycleGeneration = mediaUploadLifecycleGenerationRef.current;
    const abortController = new AbortController();
    const mediaUploadSignal = AbortSignal.any([
      indexedDbOpenRecoveryState.signal,
      abortController.signal,
    ]);
    mediaUploadAbortControllersRef.current.set(workspace.workspaceId, abortController);
    const mediaUploadTask = (async (): Promise<void> => {
      if (await waitForRecoveryGuardedSyncPhase(loadRunnableMediaUploadSession(workspace)) === null) {
        return;
      }

      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      await waitForRecoveryGuardedSyncPhase(
        processDueMediaUploadTransfersForWorkspace(
          workspace.workspaceId,
          mediaUploadSignal,
          indexedDbOpenRecoveryState.hasFailed,
          indexedDbOpenRecoveryState.markFailed,
          indexedDbOpenRecoveryState.throwIfFailed,
        ),
      );
    })().catch((error: unknown): never => {
      indexedDbOpenRecoveryState.throwIfFailed();
      markIndexedDbOpenRecoveryFailure(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      throw error;
    }).finally(() => {
      if (mediaUploadAbortControllersRef.current.get(workspace.workspaceId) === abortController) {
        mediaUploadAbortControllersRef.current.delete(workspace.workspaceId);
      }
      if (
        mediaUploadLifecycleGeneration === mediaUploadLifecycleGenerationRef.current
        && mediaUploadPromisesRef.current.get(workspace.workspaceId) === mediaUploadTask
      ) {
        mediaUploadPromisesRef.current.delete(workspace.workspaceId);
        const needsAnotherRun = mediaUploadNeedsRunWorkspaceIdsRef.current.has(workspace.workspaceId);
        mediaUploadNeedsRunWorkspaceIdsRef.current.delete(workspace.workspaceId);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (needsAnotherRun && discardedSyncWorkspaceIdsRef.current.has(workspace.workspaceId) === false) {
          runMediaUploadTransfersForWorkspaceRef.current(workspace);
          return;
        }

        runMediaUploadTransfersInBackground(
          scheduleMediaUploadRetryTimerForWorkspace(workspace),
          (error: unknown): void => {
            reportMediaUploadError(error, currentSession.userId, workspace.workspaceId);
          },
        );
      }
    });
    mediaUploadPromisesRef.current.set(workspace.workspaceId, mediaUploadTask);
    runMediaUploadTransfersInBackground(mediaUploadTask, (error: unknown): void => {
      reportMediaUploadError(error, currentSession.userId, workspace.workspaceId);
    });
  }, [
    clearMediaUploadRetryTimer,
    indexedDbOpenRecoveryState,
    loadRunnableMediaUploadSession,
    markIndexedDbOpenRecoveryFailure,
    readCurrentRunnableMediaUploadSession,
    reportMediaUploadError,
    scheduleMediaUploadRetryTimerForWorkspace,
    waitForRecoveryGuardedSyncPhase,
  ]);

  useEffect(() => {
    runMediaUploadTransfersForWorkspaceRef.current = runMediaUploadTransfersForWorkspace;
  }, [runMediaUploadTransfersForWorkspace]);

  useEffect(() => {
    isSyncEngineMountedRef.current = true;
    return () => {
      isSyncEngineMountedRef.current = false;
      syncGenerationRef.current += 1;
      abortAllWorkspaceRemoteSyncs(new Error("Workspace remote sync stopped because the sync engine unmounted"));
      syncPromisesRef.current.clear();
      syncingWorkspaceIdsRef.current.clear();
      needsResyncWorkspaceIdsRef.current.clear();
      abortAllMediaUploadTransfers();
      mediaUploadLifecycleGenerationRef.current += 1;
      mediaUploadPromisesRef.current.clear();
      mediaUploadNeedsRunWorkspaceIdsRef.current.clear();
      clearAllMediaUploadRetryTimers();
    };
  }, [abortAllMediaUploadTransfers, abortAllWorkspaceRemoteSyncs, clearAllMediaUploadRetryTimers]);

  useEffect(() => () => {
    if (activeWorkspaceId !== null) {
      clearMediaUploadRetryTimer(activeWorkspaceId);
    }
  }, [activeWorkspaceId, clearMediaUploadRetryTimer]);

  const waitForWorkspaceSyncToSettle = useCallback(async function waitForWorkspaceSyncToSettle(
    workspaceId: string,
  ): Promise<void> {
    while (true) {
      indexedDbOpenRecoveryState.throwIfFailed();
      const activeSync = syncPromisesRef.current.get(workspaceId);
      if (activeSync === undefined) {
        return;
      }

      await waitForRecoveryGuardedSyncPhase(activeSync);
    }
  }, [indexedDbOpenRecoveryState, waitForRecoveryGuardedSyncPhase]);

  const runSyncForWorkspaceInternal = useCallback(async function runSyncForWorkspaceInternal(
    workspace: WorkspaceSummary,
    reportSyncError: (report: SyncFailureReport) => void,
  ): Promise<void> {
    // Local writes may happen during warm start, but remote sync stays paused
    // until auth verification confirms which account owns this browser state.
    if (
      isDiscardingAllSyncWorkRef.current
      || indexedDbOpenRecoveryState.hasFailed()
      || session === null
      || sessionVerificationState !== "verified"
    ) {
      return;
    }

    const workspaceId = workspace.workspaceId;
    const syncGeneration = syncGenerationRef.current;
    const workspaceSyncGeneration = workspaceSyncGenerationsRef.current.get(workspaceId) ?? 0;
    if (discardedSyncWorkspaceIdsRef.current.has(workspaceId)) {
      return;
    }

    const activeSync = syncPromisesRef.current.get(workspaceId);
    if (activeSync !== undefined) {
      needsResyncWorkspaceIdsRef.current.add(workspaceId);
      return waitForRecoveryGuardedSyncPhase(activeSync);
    }

    syncingWorkspaceIdsRef.current.add(workspaceId);
    refreshSyncIndicator();
    const syncAbortController = new AbortController();
    const syncSignal = AbortSignal.any([
      indexedDbOpenRecoveryState.signal,
      syncAbortController.signal,
    ]);
    syncAbortControllersRef.current.set(workspaceId, syncAbortController);

    const syncTask = (async (): Promise<void> => {
      let syncInstallationId: string | null = null;
      const syncRunId = createSyncRunId();
      const requireCurrentWorkspaceSync = function requireCurrentWorkspaceSync(currentWorkspaceId: string): void {
        requireWorkspaceSyncNotDiscarded(currentWorkspaceId, syncGeneration, workspaceSyncGeneration);
      };
      const publishCurrentWorkspaceSettings = function publishCurrentWorkspaceSettings(
        currentWorkspaceId: string,
        workspaceSettings: WorkspaceSchedulerSettings,
      ): void {
        requireCurrentWorkspaceSync(currentWorkspaceId);
        publishWorkspaceSettings(currentWorkspaceId, workspaceSettings);
      };
      const refreshCurrentWorkspaceView = async function refreshCurrentWorkspaceView(currentWorkspaceId: string): Promise<void> {
        requireCurrentWorkspaceSync(currentWorkspaceId);
        await waitForRecoveryGuardedSyncPhase(refreshWorkspaceView(currentWorkspaceId));
        requireCurrentWorkspaceSync(currentWorkspaceId);
      };
      const observeAndReportSyncFailure = function observeAndReportSyncFailure(error: Error): Error {
        Object.assign(error, {
          syncRunId,
        });
        const wasCaptured = observeSyncFailure({
          error,
          userId: session.userId,
          workspaceId,
          installationId: syncInstallationId,
        });
        const observedError = attachSyncFailureObservation(error, wasCaptured);
        reportSyncError({
          error: observedError,
          wasCaptured,
        });
        return observedError;
      };

      try {
        requireCurrentWorkspaceSync(workspaceId);
        const cloudSettings = await waitForRecoveryGuardedSyncPhase(loadCloudSettings());
        requireCurrentWorkspaceSync(workspaceId);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        const installationId = requireCloudInstallationId(cloudSettings);
        syncInstallationId = installationId;
        const syncFlags = await waitForRecoveryGuardedSyncPhase(runWorkspaceRemoteSync({
          userId: session.userId,
          workspaceId,
          installationId,
          syncRunId,
          signal: syncSignal,
          hasFailed: indexedDbOpenRecoveryState.hasFailed,
          indexedDbOpenRecoveryState,
          isOnlyWorkspaceForUser: isOnlyWorkspaceOfAccount(availableWorkspacesRef.current, workspaceId),
          requireWorkspaceSyncNotDiscarded: requireCurrentWorkspaceSync,
          publishWorkspaceSettings: publishCurrentWorkspaceSettings,
          refreshWorkspaceView: refreshCurrentWorkspaceView,
        }));

        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        await waitForRecoveryGuardedSyncPhase(refreshCurrentWorkspaceView(workspaceId));
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (syncFlags.didChangeProgressHistory) {
          invalidateProgress();
        }
        if (syncFlags.didChangeReviewSchedule) {
          invalidateLocalReviewSchedule();
        }
        setErrorMessage("");
        runMediaUploadTransfersForWorkspace(workspace);
      } catch (error) {
        const normalizedError = normalizeCaughtError(error);
        markIndexedDbOpenRecoveryFailure(normalizedError);
        indexedDbOpenRecoveryState.throwIfFailed();

        if (isCurrentWorkspaceSync(workspaceId, syncGeneration, workspaceSyncGeneration) === false) {
          return;
        }

        if (isAuthRedirectError(error)) {
          throw error;
        }

        if (isWorkspaceSyncDiscardedError(error)) {
          return;
        }

        if (discardedSyncWorkspaceIdsRef.current.has(workspaceId)) {
          return;
        }

        if (isStaleWorkspaceNotFoundError(workspaceId, error)) {
          discardedSyncWorkspaceIdsRef.current.add(workspaceId);
          needsResyncWorkspaceIdsRef.current.delete(workspaceId);
          return;
        }

        throw observeAndReportSyncFailure(normalizedError);
      } finally {
        if (syncAbortControllersRef.current.get(workspaceId) === syncAbortController) {
          syncAbortControllersRef.current.delete(workspaceId);
          syncPromisesRef.current.delete(workspaceId);
        }
        if (
          isCurrentWorkspaceSync(workspaceId, syncGeneration, workspaceSyncGeneration)
          && indexedDbOpenRecoveryState.hasFailed() === false
        ) {
          syncingWorkspaceIdsRef.current.delete(workspaceId);
          refreshSyncIndicator();

          const needsResync = needsResyncWorkspaceIdsRef.current.has(workspaceId);
          needsResyncWorkspaceIdsRef.current.delete(workspaceId);
          if (
            needsResync
            && indexedDbOpenRecoveryState.hasFailed() === false
            && discardedSyncWorkspaceIdsRef.current.has(workspaceId) === false
          ) {
            runSyncInBackground(runSyncForWorkspace(workspace));
          }
        }
      }
    })();

    syncPromisesRef.current.set(workspaceId, syncTask);
    return syncTask;
  }, [
    indexedDbOpenRecoveryState,
    isCurrentWorkspaceSync,
    markIndexedDbOpenRecoveryFailure,
    publishWorkspaceSettings,
    refreshSyncIndicator,
    refreshWorkspaceView,
    requireWorkspaceSyncNotDiscarded,
    runMediaUploadTransfersForWorkspace,
    session,
    sessionVerificationState,
    isStaleWorkspaceNotFoundError,
    waitForRecoveryGuardedSyncPhase,
  ]);

  const runSyncForWorkspace = useCallback(async function runSyncForWorkspace(
    workspace: WorkspaceSummary,
  ): Promise<void> {
    indexedDbOpenRecoveryState.throwIfFailed();
    await waitForRecoveryGuardedSyncPhase(runSyncForWorkspaceInternal(workspace, reportGlobalSyncError));
  }, [indexedDbOpenRecoveryState, reportGlobalSyncError, runSyncForWorkspaceInternal, waitForRecoveryGuardedSyncPhase]);

  const runSync = useCallback(async function runSync(): Promise<void> {
    indexedDbOpenRecoveryState.throwIfFailed();
    if (activeWorkspace === null) {
      return;
    }

    await waitForRecoveryGuardedSyncPhase(runSyncForWorkspace(activeWorkspace));
  }, [activeWorkspace, indexedDbOpenRecoveryState, runSyncForWorkspace, waitForRecoveryGuardedSyncPhase]);

  const runSyncSilently = useCallback(async function runSyncSilently(): Promise<void> {
    indexedDbOpenRecoveryState.throwIfFailed();
    if (activeWorkspace === null) {
      return;
    }

    await waitForRecoveryGuardedSyncPhase(runSyncForWorkspaceInternal(activeWorkspace, ignoreSyncError));
  }, [activeWorkspace, ignoreSyncError, indexedDbOpenRecoveryState, runSyncForWorkspaceInternal, waitForRecoveryGuardedSyncPhase]);

  const runMediaUploadTransfers = useCallback(function runMediaUploadTransfers(): void {
    if (activeWorkspace === null) {
      return;
    }

    runMediaUploadTransfersForWorkspace(activeWorkspace);
  }, [activeWorkspace, runMediaUploadTransfersForWorkspace]);

  useEffect(() => {
    if (
      indexedDbOpenRecoveryState.isFailed
      || sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || session === null
      || activeWorkspace === null
    ) {
      return;
    }

    void waitForRecoveryGuardedSyncPhase(refreshLocalMetadata(activeWorkspace.workspaceId)).catch((error: unknown): void => {
      const normalizedError = normalizeCaughtError(error);
      markIndexedDbOpenRecoveryFailure(normalizedError);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      captureAppOperationError(normalizedError, {
        feature: "sync",
        operation: "refresh_local_metadata",
        userId: session.userId,
        workspaceId: activeWorkspace.workspaceId,
        installationId: null,
        entityId: null,
      });
    });
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    runMediaUploadTransfersForWorkspace(activeWorkspace);
  }, [
    activeWorkspace,
    indexedDbOpenRecoveryState,
    markIndexedDbOpenRecoveryFailure,
    refreshLocalMetadata,
    runMediaUploadTransfersForWorkspace,
    runSyncForWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
    waitForRecoveryGuardedSyncPhase,
  ]);

  useEffect(() => {
    if (
      indexedDbOpenRecoveryState.isFailed
      || sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || session === null
      || activeWorkspace === null
    ) {
      return;
    }

    const handleOnline = (): void => {
      runMediaUploadTransfersForWorkspace(activeWorkspace);
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [
    activeWorkspace,
    indexedDbOpenRecoveryState.isFailed,
    runMediaUploadTransfersForWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
  ]);

  const refreshLocalData = useCallback(async function refreshLocalData(): Promise<void> {
    indexedDbOpenRecoveryState.throwIfFailed();
    if (activeWorkspace === null) {
      return;
    }

    await waitForRecoveryGuardedSyncPhase(refreshWorkspaceView(activeWorkspace.workspaceId));
    await waitForRecoveryGuardedSyncPhase(runSyncForWorkspace(activeWorkspace));
    await waitForRecoveryGuardedSyncPhase(waitForWorkspaceSyncToSettle(activeWorkspace.workspaceId));
  }, [activeWorkspace, indexedDbOpenRecoveryState, refreshWorkspaceView, runSyncForWorkspace, waitForRecoveryGuardedSyncPhase, waitForWorkspaceSyncToSettle]);

  const getCardById = useCallback(async function getCardById(cardId: string): Promise<Card> {
    if (activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    return runLocalDataRead(() => requireCard(activeWorkspace.workspaceId, cardId));
  }, [activeWorkspace, runLocalDataRead]);

  const getDeckById = useCallback(async function getDeckById(deckId: string): Promise<Deck> {
    if (activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    return runLocalDataRead(() => requireDeck(activeWorkspace.workspaceId, deckId));
  }, [activeWorkspace, runLocalDataRead]);

  const requireLocalWorkspaceMutationReady = useCallback(function requireLocalWorkspaceMutationReady(): void {
    if (isDiscardingAllSyncWorkRef.current) {
      throw new Error("Workspace is unavailable");
    }

    indexedDbOpenRecoveryState.throwIfFailed();
  }, [indexedDbOpenRecoveryState]);

  const runLocalWorkspaceMutation = useCallback(function runLocalWorkspaceMutation<T>(
    createMutationTask: () => Promise<T>,
  ): Promise<T> {
    requireLocalWorkspaceMutationReady();
    let mutationTask: Promise<T>;
    try {
      mutationTask = createMutationTask();
    } catch (error) {
      markIndexedDbOpenRecoveryFailure(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      throw error;
    }
    const guardedMutationTask = mutationTask.then(
      (result: T): T => {
        indexedDbOpenRecoveryState.throwIfFailed();
        return result;
      },
      (error: unknown): never => {
        markIndexedDbOpenRecoveryFailure(error);
        indexedDbOpenRecoveryState.throwIfFailed();
        throw error;
      },
    );
    const trackedMutationTask = guardedMutationTask.finally(() => {
      localMutationPromisesRef.current.delete(trackedMutationTask);
    });
    localMutationPromisesRef.current.add(trackedMutationTask);
    return trackedMutationTask;
  }, [indexedDbOpenRecoveryState, markIndexedDbOpenRecoveryFailure, requireLocalWorkspaceMutationReady]);

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => createCardLocally(
      {
        workspaceId: activeWorkspaceId,
        input,
        clientUpdatedAt: nowIso(),
      },
      indexedDbOpenRecoveryState,
    ));
    indexedDbOpenRecoveryState.throwIfFailed();
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, indexedDbOpenRecoveryState, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => createDeckLocally(
      {
        workspaceId: activeWorkspaceId,
        input,
        clientUpdatedAt: nowIso(),
      },
      indexedDbOpenRecoveryState,
    ));
    indexedDbOpenRecoveryState.throwIfFailed();
    bumpLocalReadVersion();
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, indexedDbOpenRecoveryState, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => updateCardLocally(
      {
        workspaceId: activeWorkspaceId,
        cardId,
        input,
        clientUpdatedAt: nowIso(),
      },
      indexedDbOpenRecoveryState,
    ));
    indexedDbOpenRecoveryState.throwIfFailed();
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, indexedDbOpenRecoveryState, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const updateDeckItem = useCallback(async function updateDeckItem(deckId: string, input: UpdateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => updateDeckLocally(
      {
        workspaceId: activeWorkspaceId,
        deckId,
        input,
        clientUpdatedAt: nowIso(),
      },
      indexedDbOpenRecoveryState,
    ));
    indexedDbOpenRecoveryState.throwIfFailed();
    bumpLocalReadVersion();
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, indexedDbOpenRecoveryState, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const deleteCardItem = useCallback(async function deleteCardItem(cardId: string): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => deleteCardLocally(
      {
        workspaceId: activeWorkspaceId,
        cardId,
        clientUpdatedAt: nowIso(),
      },
      indexedDbOpenRecoveryState,
    ));
    indexedDbOpenRecoveryState.throwIfFailed();
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, indexedDbOpenRecoveryState, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const deleteDeckItem = useCallback(async function deleteDeckItem(deckId: string): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => deleteDeckLocally(
      {
        workspaceId: activeWorkspaceId,
        deckId,
        clientUpdatedAt: nowIso(),
      },
      indexedDbOpenRecoveryState,
    ));
    indexedDbOpenRecoveryState.throwIfFailed();
    bumpLocalReadVersion();
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, indexedDbOpenRecoveryState, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const submitReviewItem = useCallback(async function submitReviewItem(
    cardId: string,
    rating: 0 | 1 | 2 | 3,
  ): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const reviewedAtClient = nowIso();
    const reviewedTimeZone = getBrowserTimeZone();
    const mutationResult = await runLocalWorkspaceMutation(() => submitReviewLocally(
      {
        workspaceId: activeWorkspaceId,
        cardId,
        rating,
        reviewedAtClient,
        reviewedTimeZone,
      },
      indexedDbOpenRecoveryState,
    ));
    indexedDbOpenRecoveryState.throwIfFailed();
    bumpLocalReadVersion();
    invalidateLocalProgress();
    invalidateLocalReviewSchedule();
    runSyncInBackground(runSyncForWorkspace(activeWorkspace));
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, indexedDbOpenRecoveryState, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const seedLinkedWorkspace = useCallback(async function seedLinkedWorkspace(
    request: TestSeedRequest,
  ): Promise<TestSeedResult> {
    if (
      activeWorkspace === null
      || activeWorkspaceId === null
      || sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || session === null
      || isDiscardingAllSyncWorkRef.current
    ) {
      throw new Error("Linked workspace is not ready for deterministic seed data");
    }

    validateSeedRequest(request);
    await runLocalDataRead(() => ensureWorkspaceSeedReady({
      indexedDbOpenRecoveryState,
      workspace: activeWorkspace,
      waitForWorkspaceSyncToSettle,
      refreshWorkspaceView,
      runSyncForWorkspace,
    }));
    indexedDbOpenRecoveryState.throwIfFailed();
    const seedMutationResult = await runLocalWorkspaceMutation(() => seedWorkspaceLocally({
      indexedDbOpenRecoveryState,
      workspaceId: activeWorkspaceId,
      request,
    }));
    indexedDbOpenRecoveryState.throwIfFailed();

    bumpLocalReadVersion();
    if (seedMutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    if (seedMutationResult.didChangeProgressHistory) {
      invalidateLocalProgress();
    }

    await runSyncForWorkspace(activeWorkspace);
    indexedDbOpenRecoveryState.throwIfFailed();
    await waitForWorkspaceSyncToSettle(activeWorkspaceId);
    indexedDbOpenRecoveryState.throwIfFailed();

    return seedMutationResult.seedResult;
  }, [
    activeWorkspace,
    activeWorkspaceId,
    bumpLocalReadVersion,
    indexedDbOpenRecoveryState,
    refreshWorkspaceView,
    runLocalDataRead,
    runLocalWorkspaceMutation,
    runSyncForWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
    waitForWorkspaceSyncToSettle,
  ]);

  return {
    runSync,
    runSyncSilently,
    runSyncForWorkspace,
    runMediaUploadTransfers,
    discardWorkspaceSync,
    discardAllSyncWork,
    refreshLocalData,
    refreshWorkspaceView,
    getCardById,
    getDeckById,
    createCardItem,
    createDeckItem,
    updateCardItem,
    updateDeckItem,
    deleteCardItem,
    deleteDeckItem,
    submitReviewItem,
    seedLinkedWorkspace,
  };
}
