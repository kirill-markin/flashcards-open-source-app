import {
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  isIndexedDbOpenRecoveryFailureMark,
  type IndexedDbOpenRecoveryMarkResult,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import {
  loadNextPendingMediaTransferAttemptAtByKind,
} from "../../../localDb/mediaTransfers";
import {
  loadCloudSettings,
} from "../../../localDb/sync/cloudSettings";
import {
  captureAppOperationError,
} from "../../../observability/appOperationObservation";
import {
  normalizeCaughtError,
} from "../../../observability/webObservability";
import type {
  CloudSettings,
  SessionInfo,
  WorkspaceSummary,
} from "../../../types";
import type { SessionLoadState } from "../../context/types";
import type { SessionVerificationState } from "../../session/workspaceSessionTypes";
import {
  processDueMediaUploadTransfersForWorkspace,
} from "../mediaUploads/mediaUploadTransferRunner";

type UseMediaUploadLifecycleParams = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  isSyncWorkDiscarded: (workspaceId: string) => boolean;
}>;

type MediaUploadLifecycle = Readonly<{
  runForWorkspace: (workspace: WorkspaceSummary) => void;
  discardWorkspace: (workspaceId: string) => void;
  discardAll: () => Promise<void>;
}>;

const maximumMediaUploadRetryTimerDelayMs = 2_147_483_647;

function calculateMediaUploadRetryTimerDelayMs(nextAttemptAt: string, nowMs: number): number | null {
  const nextAttemptTime = Date.parse(nextAttemptAt);
  if (Number.isFinite(nextAttemptTime) === false) {
    throw new Error(`Media upload retry scheduling failed: invalid nextAttemptAt=${nextAttemptAt}`);
  }

  const delayMs = Math.max(0, nextAttemptTime - nowMs);
  return delayMs > maximumMediaUploadRetryTimerDelayMs ? null : delayMs;
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

export function useMediaUploadLifecycle(params: UseMediaUploadLifecycleParams): MediaUploadLifecycle {
  const {
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    indexedDbOpenRecoveryState,
    isSyncWorkDiscarded,
  } = params;
  const sessionLoadStateRef = useRef<SessionLoadState>(sessionLoadState);
  const sessionVerificationStateRef = useRef<SessionVerificationState>(sessionVerificationState);
  const sessionRef = useRef<SessionInfo | null>(session);
  const activeWorkspaceRef = useRef<WorkspaceSummary | null>(activeWorkspace);
  const mediaUploadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const mediaUploadAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const mediaUploadNeedsRunWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const mediaUploadRetryTimerIdsRef = useRef<Map<string, number>>(new Map());
  const runForWorkspaceRef = useRef<(workspace: WorkspaceSummary) => void>(() => undefined);
  const isMountedRef = useRef<boolean>(true);
  const lifecycleGenerationRef = useRef<number>(0);
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  useEffect(() => {
    sessionLoadStateRef.current = sessionLoadState;
    sessionVerificationStateRef.current = sessionVerificationState;
    sessionRef.current = session;
  }, [session, sessionLoadState, sessionVerificationState]);

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  const clearRetryTimer = useCallback(function clearRetryTimer(workspaceId: string): void {
    const timerId = mediaUploadRetryTimerIdsRef.current.get(workspaceId);
    if (timerId === undefined) {
      return;
    }

    window.clearTimeout(timerId);
    mediaUploadRetryTimerIdsRef.current.delete(workspaceId);
  }, []);

  const clearAllRetryTimers = useCallback(function clearAllRetryTimers(): void {
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

    mediaUploadNeedsRunWorkspaceIdsRef.current.clear();
    clearAllRetryTimers();
    return markResult;
  }, [clearAllRetryTimers, indexedDbOpenRecoveryState]);

  const waitForRecoveryGuardedPhase = useCallback(async function waitForRecoveryGuardedPhase<ResultType>(
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

  const abortAll = useCallback(function abortAll(): void {
    for (const controller of mediaUploadAbortControllersRef.current.values()) {
      controller.abort(new Error("Media upload lifecycle was discarded"));
    }
    mediaUploadAbortControllersRef.current.clear();
  }, []);

  const discardAllWork = useCallback(function discardAllWork(): ReadonlyArray<Promise<void>> {
    const activeTasks = [...mediaUploadPromisesRef.current.values()];
    abortAll();
    lifecycleGenerationRef.current += 1;
    mediaUploadPromisesRef.current.clear();
    mediaUploadNeedsRunWorkspaceIdsRef.current.clear();
    clearAllRetryTimers();
    return activeTasks;
  }, [abortAll, clearAllRetryTimers]);

  const stopAllForRecovery = useCallback(function stopAllForRecovery(): void {
    abortAll();
    lifecycleGenerationRef.current += 1;
    mediaUploadNeedsRunWorkspaceIdsRef.current.clear();
    clearAllRetryTimers();
  }, [abortAll, clearAllRetryTimers]);

  const reportError = useCallback(function reportError(
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

  const readCurrentRunnableSession = useCallback(function readCurrentRunnableSession(
    workspace: WorkspaceSummary,
  ): SessionInfo | null {
    const currentSession = sessionRef.current;
    if (
      isSyncWorkDiscarded(workspace.workspaceId)
      || indexedDbOpenRecoveryState.hasFailed()
      || isMountedRef.current === false
      || sessionLoadStateRef.current !== "ready"
      || currentSession === null
      || sessionVerificationStateRef.current !== "verified"
      || isBrowserOnline() === false
      || activeWorkspaceRef.current?.workspaceId !== workspace.workspaceId
    ) {
      return null;
    }

    return currentSession;
  }, [indexedDbOpenRecoveryState, isSyncWorkDiscarded]);

  const loadRunnableSession = useCallback(async function loadRunnableSession(
    workspace: WorkspaceSummary,
  ): Promise<SessionInfo | null> {
    const currentSession = readCurrentRunnableSession(workspace);
    if (currentSession === null) {
      return null;
    }

    const cloudSettings = await waitForRecoveryGuardedPhase(loadCloudSettings());
    const verifiedSession = readCurrentRunnableSession(workspace);
    if (
      verifiedSession === null
      || isLinkedMediaUploadCloudSettings(cloudSettings, verifiedSession, workspace.workspaceId) === false
    ) {
      return null;
    }

    return verifiedSession;
  }, [readCurrentRunnableSession, waitForRecoveryGuardedPhase]);

  const scheduleRetryTimerForWorkspace = useCallback(async function scheduleRetryTimerForWorkspace(
    workspace: WorkspaceSummary,
  ): Promise<void> {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const lifecycleGeneration = lifecycleGenerationRef.current;
    if (await waitForRecoveryGuardedPhase(loadRunnableSession(workspace)) === null) {
      return;
    }

    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const nextAttemptAt = await waitForRecoveryGuardedPhase(
      loadNextPendingMediaTransferAttemptAtByKind(
        workspace.workspaceId,
        "upload",
        indexedDbOpenRecoveryState,
      ),
    );
    const runnableSession = await waitForRecoveryGuardedPhase(loadRunnableSession(workspace));
    if (
      lifecycleGeneration !== lifecycleGenerationRef.current
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

    clearRetryTimer(workspace.workspaceId);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const timerId = window.setTimeout((): void => {
      if (lifecycleGeneration !== lifecycleGenerationRef.current) {
        return;
      }

      mediaUploadRetryTimerIdsRef.current.delete(workspace.workspaceId);
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      runForWorkspaceRef.current(workspace);
    }, delayMs);
    mediaUploadRetryTimerIdsRef.current.set(workspace.workspaceId, timerId);
  }, [clearRetryTimer, indexedDbOpenRecoveryState, loadRunnableSession, waitForRecoveryGuardedPhase]);

  const runForWorkspace = useCallback(function runForWorkspace(workspace: WorkspaceSummary): void {
    clearRetryTimer(workspace.workspaceId);
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const currentSession = readCurrentRunnableSession(workspace);
    if (currentSession === null) {
      return;
    }

    const activeTask = mediaUploadPromisesRef.current.get(workspace.workspaceId);
    if (activeTask !== undefined) {
      mediaUploadNeedsRunWorkspaceIdsRef.current.add(workspace.workspaceId);
      return;
    }

    const lifecycleGeneration = lifecycleGenerationRef.current;
    const abortController = new AbortController();
    const mediaUploadSignal = AbortSignal.any([
      indexedDbOpenRecoveryState.signal,
      abortController.signal,
    ]);
    mediaUploadAbortControllersRef.current.set(workspace.workspaceId, abortController);
    const mediaUploadTask = (async (): Promise<void> => {
      if (await waitForRecoveryGuardedPhase(loadRunnableSession(workspace)) === null) {
        return;
      }

      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      await waitForRecoveryGuardedPhase(
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
        lifecycleGeneration === lifecycleGenerationRef.current
        && mediaUploadPromisesRef.current.get(workspace.workspaceId) === mediaUploadTask
      ) {
        mediaUploadPromisesRef.current.delete(workspace.workspaceId);
        const needsAnotherRun = mediaUploadNeedsRunWorkspaceIdsRef.current.has(workspace.workspaceId);
        mediaUploadNeedsRunWorkspaceIdsRef.current.delete(workspace.workspaceId);
        if (indexedDbOpenRecoveryState.hasFailed()) {
          return;
        }

        if (needsAnotherRun && isSyncWorkDiscarded(workspace.workspaceId) === false) {
          runForWorkspaceRef.current(workspace);
          return;
        }

        runMediaUploadTransfersInBackground(
          scheduleRetryTimerForWorkspace(workspace),
          (error: unknown): void => {
            reportError(error, currentSession.userId, workspace.workspaceId);
          },
        );
      }
    });
    mediaUploadPromisesRef.current.set(workspace.workspaceId, mediaUploadTask);
    runMediaUploadTransfersInBackground(mediaUploadTask, (error: unknown): void => {
      reportError(error, currentSession.userId, workspace.workspaceId);
    });
  }, [
    clearRetryTimer,
    indexedDbOpenRecoveryState,
    isSyncWorkDiscarded,
    loadRunnableSession,
    markIndexedDbOpenRecoveryFailure,
    readCurrentRunnableSession,
    reportError,
    scheduleRetryTimerForWorkspace,
    waitForRecoveryGuardedPhase,
  ]);

  const discardWorkspace = useCallback(function discardWorkspace(workspaceId: string): void {
    mediaUploadAbortControllersRef.current.get(workspaceId)?.abort(
      new Error(`Media upload workspace lifecycle was discarded: workspaceId=${workspaceId}`),
    );
    clearRetryTimer(workspaceId);
    mediaUploadNeedsRunWorkspaceIdsRef.current.delete(workspaceId);
  }, [clearRetryTimer]);

  const discardAll = useCallback(async function discardAll(): Promise<void> {
    const activeTasks = discardAllWork();
    await waitForRecoveryGuardedPhase(Promise.allSettled(activeTasks));
  }, [discardAllWork, waitForRecoveryGuardedPhase]);

  useEffect(() => {
    runForWorkspaceRef.current = runForWorkspace;
  }, [runForWorkspace]);

  useEffect(() => {
    if (indexedDbOpenRecoveryState.isFailed === false) {
      return;
    }

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      return;
    } catch (error) {
      if (error instanceof Error === false) {
        throw error;
      }
    }

    stopAllForRecovery();
  }, [indexedDbOpenRecoveryState, stopAllForRecovery]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      discardAllWork();
    };
  }, [discardAllWork]);

  useEffect(() => () => {
    if (activeWorkspaceId !== null) {
      clearRetryTimer(activeWorkspaceId);
    }
  }, [activeWorkspaceId, clearRetryTimer]);

  return {
    runForWorkspace,
    discardWorkspace,
    discardAll,
  };
}
