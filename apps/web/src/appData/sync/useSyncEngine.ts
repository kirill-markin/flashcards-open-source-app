import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  isAuthRedirectError,
} from "../../api";
import {
  loadCloudSettings,
} from "../../localDb/sync/cloudSettings";
import {
  loadWorkspaceSettings,
} from "../../localDb/cards/workspace";
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
} from "../../types";
import {
  normalizeCaughtError,
} from "../../observability/webObservability";
import {
  getErrorMessage,
  nowIso,
} from "../domain";
import {
  invalidateLocalProgress,
  invalidateLocalReviewSchedule,
  invalidateProgress,
} from "../progress/invalidation/progressInvalidation";
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
import type { SessionLoadState } from "../context/types";
import type { SessionVerificationState } from "../session/warmStart";

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

function createSyncRunId(): string {
  const cryptoValue = globalThis.crypto;
  if (typeof cryptoValue?.randomUUID === "function") {
    return cryptoValue.randomUUID();
  }

  return `sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
  const localReadPromisesRef = useRef<Set<Promise<unknown>>>(new Set());
  const localMutationPromisesRef = useRef<Set<Promise<unknown>>>(new Set());
  const needsResyncWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const syncingWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const discardedSyncWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const syncGenerationRef = useRef<number>(0);
  const isDiscardingAllSyncWorkRef = useRef<boolean>(false);
  const discardAllSyncWorkPromiseRef = useRef<Promise<void> | null>(null);

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

  const discardAllSyncWork = useCallback(async function discardAllSyncWork(
    runWhileDiscarding: () => Promise<void>,
  ): Promise<void> {
    const activeDiscard = discardAllSyncWorkPromiseRef.current;
    if (activeDiscard !== null) {
      return activeDiscard;
    }

    const discardTask = (async (): Promise<void> => {
      isDiscardingAllSyncWorkRef.current = true;
      const activeSyncTasks = [...syncPromisesRef.current.values()];
      const activeLocalReadTasks = [...localReadPromisesRef.current.values()];
      const activeLocalMutationTasks = [...localMutationPromisesRef.current.values()];
      syncGenerationRef.current += 1;
      syncPromisesRef.current.clear();
      needsResyncWorkspaceIdsRef.current.clear();
      syncingWorkspaceIdsRef.current.clear();
      discardedSyncWorkspaceIdsRef.current.clear();
      refreshSyncIndicator();

      try {
        await Promise.allSettled([...activeSyncTasks, ...activeLocalReadTasks, ...activeLocalMutationTasks]);
        await runWhileDiscarding();
      } finally {
        discardAllSyncWorkPromiseRef.current = null;
        isDiscardingAllSyncWorkRef.current = false;
      }
    })();
    discardAllSyncWorkPromiseRef.current = discardTask;
    return discardTask;
  }, [refreshSyncIndicator]);

  const requireWorkspaceSyncNotDiscarded = useCallback(function requireWorkspaceSyncNotDiscarded(
    workspaceId: string,
    syncGeneration: number,
  ): void {
    if (
      syncGeneration !== syncGenerationRef.current
      || discardedSyncWorkspaceIdsRef.current.has(workspaceId)
    ) {
      throw createWorkspaceSyncDiscardedError(workspaceId);
    }
  }, []);

  const isStaleWorkspaceNotFoundError = useCallback(function isStaleWorkspaceNotFoundError(
    workspaceId: string,
    error: unknown,
  ): boolean {
    return isWorkspaceNotFoundError(error) && isVisibleWorkspace(workspaceId) === false;
  }, [isVisibleWorkspace]);

  const runLocalDataRead = useCallback(async function runLocalDataRead<ResultType>(
    createReadTask: () => Promise<ResultType>,
  ): Promise<ResultType> {
    if (isDiscardingAllSyncWorkRef.current) {
      throw new Error("Workspace is unavailable");
    }

    const readTask: Promise<ResultType> = Promise.resolve().then(createReadTask);
    const trackedReadTask = readTask.finally(() => {
      localReadPromisesRef.current.delete(trackedReadTask);
    });
    localReadPromisesRef.current.add(trackedReadTask);
    return trackedReadTask;
  }, []);

  const refreshLocalMetadata = useCallback(async function refreshLocalMetadata(workspaceId: string): Promise<void> {
    if (isDiscardingAllSyncWorkRef.current) {
      return;
    }

    const metadataGeneration = syncGenerationRef.current;
    const [workspaceSettings, cloudSettings] = await runLocalDataRead(() => Promise.all([
      loadWorkspaceSettings(workspaceId),
      loadCloudSettings(),
    ]));
    if (metadataGeneration !== syncGenerationRef.current || isDiscardingAllSyncWorkRef.current) {
      return;
    }

    setCloudSettings(cloudSettings);
    if (isVisibleWorkspace(workspaceId)) {
      setWorkspaceSettings(workspaceSettings);
    }
  }, [isVisibleWorkspace, runLocalDataRead, setCloudSettings, setWorkspaceSettings]);

  const refreshWorkspaceView = useCallback(async function refreshWorkspaceView(workspaceId: string): Promise<void> {
    const metadataGeneration = syncGenerationRef.current;
    await refreshLocalMetadata(workspaceId);
    if (metadataGeneration !== syncGenerationRef.current) {
      return;
    }

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
    if (isDiscardingAllSyncWorkRef.current || session === null || sessionVerificationState !== "verified") {
      return;
    }

    const workspaceId = workspace.workspaceId;
    const syncGeneration = syncGenerationRef.current;
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
      const syncRunId = createSyncRunId();
      const requireCurrentWorkspaceSync = function requireCurrentWorkspaceSync(currentWorkspaceId: string): void {
        requireWorkspaceSyncNotDiscarded(currentWorkspaceId, syncGeneration);
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
        await refreshWorkspaceView(currentWorkspaceId);
        requireCurrentWorkspaceSync(currentWorkspaceId);
      };

      try {
        requireCurrentWorkspaceSync(workspaceId);
        const cloudSettings = await loadCloudSettings();
        requireCurrentWorkspaceSync(workspaceId);
        const installationId = requireCloudInstallationId(cloudSettings);
        syncInstallationId = installationId;
        const syncFlags = await runWorkspaceRemoteSync({
          userId: session.userId,
          workspaceId,
          installationId,
          syncRunId,
          requireWorkspaceSyncNotDiscarded: requireCurrentWorkspaceSync,
          publishWorkspaceSettings: publishCurrentWorkspaceSettings,
          refreshWorkspaceView: refreshCurrentWorkspaceView,
        });

        await refreshCurrentWorkspaceView(workspaceId);
        if (syncFlags.didChangeProgressHistory) {
          invalidateProgress();
        }
        if (syncFlags.didChangeReviewSchedule) {
          invalidateLocalReviewSchedule();
        }
        setErrorMessage("");
      } catch (error) {
        if (syncGeneration !== syncGenerationRef.current) {
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

        const normalizedError = normalizeCaughtError(error);
        Object.assign(normalizedError, {
          syncRunId,
        });
        observeSyncFailure({
          error: normalizedError,
          userId: session.userId,
          workspaceId,
          installationId: syncInstallationId,
        });
        reportSyncError(getErrorMessage(normalizedError));
        throw normalizedError;
      } finally {
        if (syncGeneration === syncGenerationRef.current) {
          syncPromisesRef.current.delete(workspaceId);
          syncingWorkspaceIdsRef.current.delete(workspaceId);
          refreshSyncIndicator();

          const needsResync = needsResyncWorkspaceIdsRef.current.has(workspaceId);
          needsResyncWorkspaceIdsRef.current.delete(workspaceId);
          if (needsResync && discardedSyncWorkspaceIdsRef.current.has(workspaceId) === false) {
            void runSyncForWorkspace(workspace);
          }
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

    return runLocalDataRead(() => requireCard(activeWorkspace.workspaceId, cardId));
  }, [activeWorkspace, runLocalDataRead]);

  const getDeckById = useCallback(async function getDeckById(deckId: string): Promise<Deck> {
    if (activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    return runLocalDataRead(() => requireDeck(activeWorkspace.workspaceId, deckId));
  }, [activeWorkspace, runLocalDataRead]);

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  const requireLocalWorkspaceMutationReady = useCallback(function requireLocalWorkspaceMutationReady(): void {
    if (isDiscardingAllSyncWorkRef.current) {
      throw new Error("Workspace is unavailable");
    }
  }, []);

  const runLocalWorkspaceMutation = useCallback(async function runLocalWorkspaceMutation<T>(
    createMutationTask: () => Promise<T>,
  ): Promise<T> {
    requireLocalWorkspaceMutationReady();
    const mutationTask = createMutationTask();
    const trackedMutationTask = mutationTask.finally(() => {
      localMutationPromisesRef.current.delete(trackedMutationTask);
    });
    localMutationPromisesRef.current.add(trackedMutationTask);
    return trackedMutationTask;
  }, [requireLocalWorkspaceMutationReady]);

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => createCardLocally({
      workspaceId: activeWorkspaceId,
      input,
      clientUpdatedAt: nowIso(),
    }));
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => createDeckLocally({
      workspaceId: activeWorkspaceId,
      input,
      clientUpdatedAt: nowIso(),
    }));
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => updateCardLocally({
      workspaceId: activeWorkspaceId,
      cardId,
      input,
      clientUpdatedAt: nowIso(),
    }));
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const updateDeckItem = useCallback(async function updateDeckItem(deckId: string, input: UpdateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => updateDeckLocally({
      workspaceId: activeWorkspaceId,
      deckId,
      input,
      clientUpdatedAt: nowIso(),
    }));
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const deleteCardItem = useCallback(async function deleteCardItem(cardId: string): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => deleteCardLocally({
      workspaceId: activeWorkspaceId,
      cardId,
      clientUpdatedAt: nowIso(),
    }));
    bumpLocalReadVersion();
    if (mutationResult.didChangeReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const deleteDeckItem = useCallback(async function deleteDeckItem(deckId: string): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => deleteDeckLocally({
      workspaceId: activeWorkspaceId,
      deckId,
      clientUpdatedAt: nowIso(),
    }));
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.deck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runLocalWorkspaceMutation, runSyncForWorkspace]);

  const submitReviewItem = useCallback(async function submitReviewItem(
    cardId: string,
    rating: 0 | 1 | 2 | 3,
  ): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const mutationResult = await runLocalWorkspaceMutation(() => submitReviewLocally({
      workspaceId: activeWorkspaceId,
      cardId,
      rating,
      reviewedAtClient: nowIso(),
    }));
    bumpLocalReadVersion();
    invalidateLocalProgress();
    invalidateLocalReviewSchedule();
    void runSyncForWorkspace(activeWorkspace);
    return mutationResult.card;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runLocalWorkspaceMutation, runSyncForWorkspace]);

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
      workspace: activeWorkspace,
      waitForWorkspaceSyncToSettle,
      refreshWorkspaceView,
      runSyncForWorkspace,
    }));
    const seedMutationResult = await runLocalWorkspaceMutation(() => seedWorkspaceLocally({
      workspaceId: activeWorkspaceId,
      request,
    }));

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
