import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  isAuthRedirectError,
} from "../api";
import {
  loadCloudSettings,
} from "../localDb/cloudSettings";
import {
  loadWorkspaceSettings,
} from "../localDb/workspace";
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
} from "../types";
import {
  normalizeCaughtError,
} from "../observability/webObservability";
import {
  getErrorMessage,
  nowIso,
} from "./domain";
import {
  invalidateLocalProgress,
  invalidateLocalReviewSchedule,
  invalidateProgress,
} from "./progress/progressInvalidation";
import {
  requireCloudInstallationId,
} from "./syncCloudSettings";
import {
  createWorkspaceSyncDiscardedError,
  isWorkspaceNotFoundError,
  isWorkspaceSyncDiscardedError,
  observeSyncFailure,
} from "./syncErrorObservation";
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
} from "./syncLocalMutations";
import {
  runWorkspaceRemoteSync,
} from "./syncRemote";
import {
  ensureWorkspaceSeedReady,
  seedWorkspaceLocally,
  validateSeedRequest,
} from "./syncSeed";
import type { TestSeedRequest, TestSeedResult } from "./testSeedBridge";
import type { SessionLoadState } from "./types";
import type { SessionVerificationState } from "./warmStart";

type UseSyncEngineParams = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  setWorkspaceSettings: Dispatch<SetStateAction<WorkspaceSchedulerSettings | null>>;
  setCloudSettings: Dispatch<SetStateAction<CloudSettings | null>>;
  setLocalReadVersion: Dispatch<SetStateAction<number>>;
  setIsSyncing: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
}>;

type SyncEngine = Readonly<{
  runSync: () => Promise<void>;
  runSyncSilently: () => Promise<void>;
  runSyncForWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
  discardWorkspaceSync: (workspaceId: string) => void;
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

export function useSyncEngine(params: UseSyncEngineParams): SyncEngine {
  const {
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    setWorkspaceSettings,
    setCloudSettings,
    setLocalReadVersion,
    setIsSyncing,
    setErrorMessage,
  } = params;
  const activeWorkspaceRef = useRef<WorkspaceSummary | null>(activeWorkspace);
  const syncPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  const needsResyncWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const syncingWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const discardedSyncWorkspaceIdsRef = useRef<Set<string>>(new Set());

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

  const discardWorkspaceSync = useCallback(function discardWorkspaceSync(workspaceId: string): void {
    discardedSyncWorkspaceIdsRef.current.add(workspaceId);
    needsResyncWorkspaceIdsRef.current.delete(workspaceId);
    syncingWorkspaceIdsRef.current.delete(workspaceId);
    refreshSyncIndicator();
  }, [refreshSyncIndicator]);

  const requireWorkspaceSyncNotDiscarded = useCallback(function requireWorkspaceSyncNotDiscarded(
    workspaceId: string,
  ): void {
    if (discardedSyncWorkspaceIdsRef.current.has(workspaceId)) {
      throw createWorkspaceSyncDiscardedError(workspaceId);
    }
  }, []);

  const isStaleWorkspaceNotFoundError = useCallback(function isStaleWorkspaceNotFoundError(
    workspaceId: string,
    error: unknown,
  ): boolean {
    return isWorkspaceNotFoundError(error) && isVisibleWorkspace(workspaceId) === false;
  }, [isVisibleWorkspace]);

  const refreshLocalMetadata = useCallback(async function refreshLocalMetadata(workspaceId: string): Promise<void> {
    const [workspaceSettings, cloudSettings] = await Promise.all([
      loadWorkspaceSettings(workspaceId),
      loadCloudSettings(),
    ]);
    setCloudSettings(cloudSettings);
    if (isVisibleWorkspace(workspaceId)) {
      setWorkspaceSettings(workspaceSettings);
    }
  }, [isVisibleWorkspace, setCloudSettings, setWorkspaceSettings]);

  const refreshWorkspaceView = useCallback(async function refreshWorkspaceView(workspaceId: string): Promise<void> {
    await refreshLocalMetadata(workspaceId);
    if (isVisibleWorkspace(workspaceId)) {
      bumpLocalReadVersion();
    }
  }, [bumpLocalReadVersion, isVisibleWorkspace, refreshLocalMetadata]);

  const publishWorkspaceSettings = useCallback(function publishWorkspaceSettings(
    workspaceId: string,
    workspaceSettings: WorkspaceSchedulerSettings,
  ): void {
    if (isVisibleWorkspace(workspaceId)) {
      setWorkspaceSettings(workspaceSettings);
    }
  }, [isVisibleWorkspace, setWorkspaceSettings]);

  const reportGlobalSyncError = useCallback(function reportGlobalSyncError(errorMessage: string): void {
    setErrorMessage(errorMessage);
  }, [setErrorMessage]);

  const ignoreSyncError = useCallback(function ignoreSyncError(_errorMessage: string): void {
  }, []);

  const waitForWorkspaceSyncToSettle = useCallback(async function waitForWorkspaceSyncToSettle(
    workspaceId: string,
  ): Promise<void> {
    while (true) {
      const activeSync = syncPromisesRef.current.get(workspaceId);
      if (activeSync === undefined) {
        return;
      }

      await activeSync;
    }
  }, []);

  const runSyncForWorkspaceInternal = useCallback(async function runSyncForWorkspaceInternal(
    workspace: WorkspaceSummary,
    reportSyncError: (errorMessage: string) => void,
  ): Promise<void> {
    // Local writes may happen during warm start, but remote sync stays paused
    // until auth verification confirms which account owns this browser state.
    if (session === null || sessionVerificationState !== "verified") {
      return;
    }

    const workspaceId = workspace.workspaceId;
    if (discardedSyncWorkspaceIdsRef.current.has(workspaceId)) {
      return;
    }

    const activeSync = syncPromisesRef.current.get(workspaceId);
    if (activeSync !== undefined) {
      needsResyncWorkspaceIdsRef.current.add(workspaceId);
      return activeSync;
    }

    syncingWorkspaceIdsRef.current.add(workspaceId);
    refreshSyncIndicator();

    const syncTask = (async (): Promise<void> => {
      let syncInstallationId: string | null = null;
      try {
        requireWorkspaceSyncNotDiscarded(workspaceId);
        const cloudSettings = await loadCloudSettings();
        requireWorkspaceSyncNotDiscarded(workspaceId);
        const installationId = requireCloudInstallationId(cloudSettings);
        syncInstallationId = installationId;
        const syncFlags = await runWorkspaceRemoteSync({
          workspaceId,
          installationId,
          requireWorkspaceSyncNotDiscarded,
          publishWorkspaceSettings,
          refreshWorkspaceView,
        });

        await refreshWorkspaceView(workspaceId);
        requireWorkspaceSyncNotDiscarded(workspaceId);
        if (syncFlags.didChangeProgressHistory) {
          invalidateProgress();
        }
        if (syncFlags.didChangeReviewSchedule) {
          invalidateLocalReviewSchedule();
        }
        setErrorMessage("");
      } catch (error) {
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

        const normalizedError = normalizeCaughtError(error);
        observeSyncFailure({
          error: normalizedError,
          userId: session.userId,
          workspaceId,
          installationId: syncInstallationId,
        });
        reportSyncError(getErrorMessage(error));
        throw error;
      } finally {
        syncPromisesRef.current.delete(workspaceId);
        syncingWorkspaceIdsRef.current.delete(workspaceId);
        refreshSyncIndicator();

        const needsResync = needsResyncWorkspaceIdsRef.current.has(workspaceId);
        needsResyncWorkspaceIdsRef.current.delete(workspaceId);
        if (needsResync && discardedSyncWorkspaceIdsRef.current.has(workspaceId) === false) {
          void runSyncForWorkspace(workspace);
        }
      }
    })();

    syncPromisesRef.current.set(workspaceId, syncTask);
    return syncTask;
  }, [
    publishWorkspaceSettings,
    refreshSyncIndicator,
    refreshWorkspaceView,
    requireWorkspaceSyncNotDiscarded,
    session,
    sessionVerificationState,
    isStaleWorkspaceNotFoundError,
  ]);

  const runSyncForWorkspace = useCallback(async function runSyncForWorkspace(
    workspace: WorkspaceSummary,
  ): Promise<void> {
    await runSyncForWorkspaceInternal(workspace, reportGlobalSyncError);
  }, [reportGlobalSyncError, runSyncForWorkspaceInternal]);

  const runSync = useCallback(async function runSync(): Promise<void> {
    if (activeWorkspace === null) {
      return;
    }

    await runSyncForWorkspace(activeWorkspace);
  }, [activeWorkspace, runSyncForWorkspace]);

  const runSyncSilently = useCallback(async function runSyncSilently(): Promise<void> {
    if (activeWorkspace === null) {
      return;
    }

    await runSyncForWorkspaceInternal(activeWorkspace, ignoreSyncError);
  }, [activeWorkspace, ignoreSyncError, runSyncForWorkspaceInternal]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || sessionVerificationState !== "verified" || session === null || activeWorkspace === null) {
      return;
    }

    void refreshLocalMetadata(activeWorkspace.workspaceId);
    void runSyncForWorkspace(activeWorkspace);
  }, [activeWorkspace, refreshLocalMetadata, runSyncForWorkspace, session, sessionLoadState, sessionVerificationState]);

  const refreshLocalData = useCallback(async function refreshLocalData(): Promise<void> {
    if (activeWorkspace === null) {
      return;
    }

    await refreshWorkspaceView(activeWorkspace.workspaceId);
    await runSyncForWorkspace(activeWorkspace);
    await waitForWorkspaceSyncToSettle(activeWorkspace.workspaceId);
  }, [activeWorkspace, refreshWorkspaceView, runSyncForWorkspace, waitForWorkspaceSyncToSettle]);

  const getCardById = useCallback(async function getCardById(cardId: string): Promise<Card> {
    if (activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    return requireCard(activeWorkspace.workspaceId, cardId);
  }, [activeWorkspace]);

  const getDeckById = useCallback(async function getDeckById(deckId: string): Promise<Deck> {
    if (activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    return requireDeck(activeWorkspace.workspaceId, deckId);
  }, [activeWorkspace]);

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await createCardLocally({
      workspaceId: activeWorkspaceId,
      input,
      clientUpdatedAt: nowIso(),
    });
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await createDeckLocally({
      workspaceId: activeWorkspaceId,
      input,
      clientUpdatedAt: nowIso(),
    });
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await updateCardLocally({
      workspaceId: activeWorkspaceId,
      cardId,
      input,
      clientUpdatedAt: nowIso(),
    });
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const updateDeckItem = useCallback(async function updateDeckItem(deckId: string, input: UpdateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await updateDeckLocally({
      workspaceId: activeWorkspaceId,
      deckId,
      input,
      clientUpdatedAt: nowIso(),
    });
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const deleteCardItem = useCallback(async function deleteCardItem(cardId: string): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await deleteCardLocally({
      workspaceId: activeWorkspaceId,
      cardId,
      clientUpdatedAt: nowIso(),
    });
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const deleteDeckItem = useCallback(async function deleteDeckItem(deckId: string): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await deleteDeckLocally({
      workspaceId: activeWorkspaceId,
      deckId,
      clientUpdatedAt: nowIso(),
    });
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const submitReviewItem = useCallback(async function submitReviewItem(
    cardId: string,
    rating: 0 | 1 | 2 | 3,
  ): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await submitReviewLocally({
      workspaceId: activeWorkspaceId,
      cardId,
      rating,
      reviewedAtClient: nowIso(),
    });
    bumpLocalReadVersion();
    invalidateLocalProgress();
    invalidateLocalReviewSchedule();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const seedLinkedWorkspace = useCallback(async function seedLinkedWorkspace(
    request: TestSeedRequest,
  ): Promise<TestSeedResult> {
    if (
      activeWorkspace === null
      || activeWorkspaceId === null
      || sessionLoadState !== "ready"
      || sessionVerificationState !== "verified"
      || session === null
    ) {
      throw new Error("Linked workspace is not ready for deterministic seed data");
    }

    validateSeedRequest(request);
    await ensureWorkspaceSeedReady({
      workspace: activeWorkspace,
      waitForWorkspaceSyncToSettle,
      refreshWorkspaceView,
      runSyncForWorkspace,
    });
    const seedMutationResult = await seedWorkspaceLocally({
      workspaceId: activeWorkspaceId,
      request,
    });

    bumpLocalReadVersion();
    if (seedMutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    if (seedMutationResult.didChangeProgressHistory) {
      invalidateLocalProgress();
    }

    await runSyncForWorkspace(activeWorkspace);
    await waitForWorkspaceSyncToSettle(activeWorkspaceId);

    return seedMutationResult.seedResult;
  }, [
    activeWorkspace,
    activeWorkspaceId,
    bumpLocalReadVersion,
    refreshWorkspaceView,
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
    discardWorkspaceSync,
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
