import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  bootstrapPullSyncState,
  isAuthRedirectError,
  pullReviewHistorySync,
  pullSyncChanges,
  pushSyncOperations,
} from "../api";
import { webAppVersion } from "../clientIdentity";
import {
  loadCardById,
  putCard,
} from "../localDb/cards";
import {
  loadCloudSettings,
} from "../localDb/cloudSettings";
import {
  loadDeckById,
  putDeck,
} from "../localDb/decks";
import {
  deleteOutboxRecord,
  listOutboxRecords,
  putOutboxRecord,
  type PersistedOutboxRecord,
} from "../localDb/outbox";
import { putReviewEvent } from "../localDb/reviews";
import {
  applyHotSyncPage,
  applyReviewHistorySyncPage,
  hasHydratedHotState,
  hasHydratedReviewHistory,
  loadLastAppliedHotChangeId,
  loadLastAppliedReviewSequenceId,
  loadWorkspaceSettings,
} from "../localDb/workspace";
import type {
  Card,
  CloudSettings,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  ReviewEvent,
  SessionInfo,
  SyncBootstrapEntry,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../types";
import { computeReviewSchedule, type ReviewRating } from "../../../backend/src/schedule";
import {
  buildCardUpsertOperation,
  buildDeck,
  buildDeckUpsertOperation,
  buildDeletedCard,
  buildDeletedDeck,
  buildInitialCard,
  buildReviewEvent,
  buildReviewEventAppendOperation,
  buildReviewedCard,
  buildUpdatedCard,
  buildUpdatedDeck,
  getErrorMessage,
  normalizeCreateCardInput,
  normalizeCreateDeckInput,
  normalizeUpdateCardInput,
  normalizeUpdateDeckInput,
  nowIso,
  toReviewableCardState,
} from "./domain";
import type { SessionLoadState } from "./types";

const syncPageSize = 200;

type UseSyncEngineParams = Readonly<{
  sessionLoadState: SessionLoadState;
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
  runSyncForWorkspace: (workspace: WorkspaceSummary) => Promise<void>;
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
}>;

async function requireCard(workspaceId: string, cardId: string): Promise<Card> {
  const card = await loadCardById(workspaceId, cardId);
  if (card === null) {
    throw new Error(`Card not found: ${cardId}`);
  }

  return card;
}

async function requireDeck(workspaceId: string, deckId: string): Promise<Deck> {
  const deck = await loadDeckById(workspaceId, deckId);
  if (deck === null) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  return deck;
}

function requireCloudDeviceId(cloudSettings: CloudSettings | null): string {
  if (cloudSettings === null) {
    throw new Error("Cloud settings are not loaded");
  }

  if (cloudSettings.deviceId.trim() === "") {
    throw new Error("Cloud settings deviceId is not loaded");
  }

  return cloudSettings.deviceId;
}

function findLastWorkspaceSettingsEntry(
  entries: ReadonlyArray<SyncBootstrapEntry>,
): WorkspaceSchedulerSettings | null {
  let lastSettings: WorkspaceSchedulerSettings | null = null;

  for (const entry of entries) {
    if (entry.entityType === "workspace_scheduler_settings") {
      lastSettings = entry.payload;
    }
  }

  return lastSettings;
}

export function useSyncEngine(params: UseSyncEngineParams): SyncEngine {
  const {
    sessionLoadState,
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

  const runSyncForWorkspace = useCallback(async function runSyncForWorkspace(
    workspace: WorkspaceSummary,
  ): Promise<void> {
    if (session === null) {
      return;
    }

    const workspaceId = workspace.workspaceId;
    const activeSync = syncPromisesRef.current.get(workspaceId);
    if (activeSync !== undefined) {
      needsResyncWorkspaceIdsRef.current.add(workspaceId);
      return activeSync;
    }

    syncingWorkspaceIdsRef.current.add(workspaceId);
    refreshSyncIndicator();

    const syncTask = (async (): Promise<void> => {
      try {
        const cloudSettings = await loadCloudSettings();
        const deviceId = requireCloudDeviceId(cloudSettings);
        const hotStateHydrated = await hasHydratedHotState(workspaceId);
        if (hotStateHydrated === false) {
          let bootstrapCursor: string | null = null;

          while (true) {
            const bootstrapResult = await bootstrapPullSyncState(
              workspaceId,
              deviceId,
              "web",
              webAppVersion,
              bootstrapCursor,
              syncPageSize,
            );

            await applyHotSyncPage(
              workspaceId,
              bootstrapResult.entries,
              bootstrapResult.hasMore
                ? null
                : {
                  lastAppliedHotChangeId: bootstrapResult.bootstrapHotChangeId,
                  markHotStateHydrated: true,
                },
            );

            if (isVisibleWorkspace(workspaceId)) {
              const lastSettings = findLastWorkspaceSettingsEntry(bootstrapResult.entries);
              if (lastSettings !== null) {
                setWorkspaceSettings(lastSettings);
              }
            }

            bootstrapCursor = bootstrapResult.nextCursor;
            if (bootstrapResult.hasMore === false) {
              break;
            }
          }
          await refreshWorkspaceView(workspaceId);
        }

        let currentOutbox = await listOutboxRecords(workspaceId);
        while (currentOutbox.length > 0) {
          const batch = currentOutbox.slice(0, 100);
          try {
            const pushResult = await pushSyncOperations(
              workspaceId,
              deviceId,
              "web",
              webAppVersion,
              batch.map((record) => record.operation),
            );

            for (const result of pushResult.operations) {
              if (result.status === "applied" || result.status === "ignored" || result.status === "duplicate") {
                await deleteOutboxRecord(workspaceId, result.operationId);
              }
            }
          } catch (error) {
            const errorMessage = getErrorMessage(error);
            for (const record of batch) {
              await putOutboxRecord({
                ...record,
                attemptCount: record.attemptCount + 1,
                lastError: errorMessage,
              });
            }
            throw error;
          }

          currentOutbox = await listOutboxRecords(workspaceId);
        }

        let afterHotChangeId = await loadLastAppliedHotChangeId(workspaceId);
        while (true) {
          const pullResult = await pullSyncChanges(
            workspaceId,
            deviceId,
            "web",
            webAppVersion,
            afterHotChangeId,
            syncPageSize,
          );

          await applyHotSyncPage(workspaceId, pullResult.changes, {
            lastAppliedHotChangeId: pullResult.nextHotChangeId,
            markHotStateHydrated: false,
          });

          if (isVisibleWorkspace(workspaceId)) {
            const lastSettings = findLastWorkspaceSettingsEntry(pullResult.changes);
            if (lastSettings !== null) {
              setWorkspaceSettings(lastSettings);
            }
          }

          afterHotChangeId = pullResult.nextHotChangeId;

          if (pullResult.hasMore === false) {
            break;
          }
        }

        let afterReviewSequenceId = await loadLastAppliedReviewSequenceId(workspaceId);
        const reviewHistoryHydrated = await hasHydratedReviewHistory(workspaceId);
        while (true) {
          const reviewHistoryResult = await pullReviewHistorySync(
            workspaceId,
            deviceId,
            "web",
            webAppVersion,
            afterReviewSequenceId,
            syncPageSize,
          );

          await applyReviewHistorySyncPage(workspaceId, reviewHistoryResult.reviewEvents, {
            lastAppliedReviewSequenceId: reviewHistoryResult.nextReviewSequenceId,
            markReviewHistoryHydrated: reviewHistoryHydrated === false && reviewHistoryResult.hasMore === false,
          });

          afterReviewSequenceId = reviewHistoryResult.nextReviewSequenceId;

          if (reviewHistoryResult.hasMore === false) {
            break;
          }
        }

        await refreshWorkspaceView(workspaceId);
        setErrorMessage("");
      } catch (error) {
        if (isAuthRedirectError(error)) {
          throw error;
        }

        setErrorMessage(getErrorMessage(error));
        throw error;
      } finally {
        syncPromisesRef.current.delete(workspaceId);
        syncingWorkspaceIdsRef.current.delete(workspaceId);
        refreshSyncIndicator();

        if (needsResyncWorkspaceIdsRef.current.has(workspaceId)) {
          needsResyncWorkspaceIdsRef.current.delete(workspaceId);
          void runSyncForWorkspace(workspace);
        }
      }
    })();

    syncPromisesRef.current.set(workspaceId, syncTask);
    return syncTask;
  }, [
    isVisibleWorkspace,
    refreshSyncIndicator,
    refreshWorkspaceView,
    session,
    setErrorMessage,
    setWorkspaceSettings,
  ]);

  const runSync = useCallback(async function runSync(): Promise<void> {
    if (activeWorkspace === null) {
      return;
    }

    await runSyncForWorkspace(activeWorkspace);
  }, [activeWorkspace, runSyncForWorkspace]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || session === null || activeWorkspace === null) {
      return;
    }

    void refreshLocalMetadata(activeWorkspace.workspaceId);
    void runSyncForWorkspace(activeWorkspace);
  }, [activeWorkspace, refreshLocalMetadata, runSyncForWorkspace, session, sessionLoadState]);

  const refreshLocalData = useCallback(async function refreshLocalData(): Promise<void> {
    if (activeWorkspace === null) {
      return;
    }

    await refreshWorkspaceView(activeWorkspace.workspaceId);
    await runSyncForWorkspace(activeWorkspace);
  }, [activeWorkspace, refreshWorkspaceView, runSyncForWorkspace]);

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

    const normalizedInput = normalizeCreateCardInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = requireCloudDeviceId(await loadCloudSettings());
    const nextCard = buildInitialCard(normalizedInput, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return nextCard;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const normalizedInput = normalizeCreateDeckInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = requireCloudDeviceId(await loadCloudSettings());
    const nextDeck = {
      ...buildDeck(normalizedInput, clientUpdatedAt, deviceId, operationId),
      workspaceId: activeWorkspaceId,
    };
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildDeckUpsertOperation(nextDeck),
    };

    await putDeck(nextDeck);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return nextDeck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingCard = await requireCard(activeWorkspaceId, cardId);
    const normalizedInput = normalizeUpdateCardInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = requireCloudDeviceId(await loadCloudSettings());
    const nextCard = buildUpdatedCard(existingCard, normalizedInput, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return nextCard;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const updateDeckItem = useCallback(async function updateDeckItem(deckId: string, input: UpdateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingDeck = await requireDeck(activeWorkspaceId, deckId);
    const normalizedInput = normalizeUpdateDeckInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = requireCloudDeviceId(await loadCloudSettings());
    const nextDeck = buildUpdatedDeck(existingDeck, normalizedInput, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildDeckUpsertOperation(nextDeck),
    };

    await putDeck(nextDeck);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return nextDeck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const deleteCardItem = useCallback(async function deleteCardItem(cardId: string): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingCard = await requireCard(activeWorkspaceId, cardId);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = requireCloudDeviceId(await loadCloudSettings());
    const nextCard = buildDeletedCard(existingCard, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return nextCard;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const deleteDeckItem = useCallback(async function deleteDeckItem(deckId: string): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingDeck = await requireDeck(activeWorkspaceId, deckId);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = requireCloudDeviceId(await loadCloudSettings());
    const nextDeck = buildDeletedDeck(existingDeck, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildDeckUpsertOperation(nextDeck),
    };

    await putDeck(nextDeck);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return nextDeck;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  const submitReviewItem = useCallback(async function submitReviewItem(
    cardId: string,
    rating: 0 | 1 | 2 | 3,
  ): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const [existingCard, schedulerSettings] = await Promise.all([
      requireCard(activeWorkspaceId, cardId),
      loadWorkspaceSettings(activeWorkspaceId),
    ]);
    if (schedulerSettings === null) {
      throw new Error("Workspace scheduler settings are not loaded");
    }

    const reviewedAtClient = nowIso();
    const reviewEventId = crypto.randomUUID().toLowerCase();
    const clientEventId = crypto.randomUUID().toLowerCase();
    const cardOperationId = crypto.randomUUID().toLowerCase();
    const deviceId = requireCloudDeviceId(await loadCloudSettings());
    const schedule = computeReviewSchedule(
      toReviewableCardState(existingCard),
      {
        algorithm: schedulerSettings.algorithm,
        desiredRetention: schedulerSettings.desiredRetention,
        learningStepsMinutes: schedulerSettings.learningStepsMinutes,
        relearningStepsMinutes: schedulerSettings.relearningStepsMinutes,
        maximumIntervalDays: schedulerSettings.maximumIntervalDays,
        enableFuzz: schedulerSettings.enableFuzz,
      },
      rating as ReviewRating,
      new Date(reviewedAtClient),
    );

    const nextCard = buildReviewedCard(existingCard, schedule, reviewedAtClient, deviceId, cardOperationId);
    const nextReviewEvent = buildReviewEvent(
      activeWorkspaceId,
      cardId,
      deviceId,
      rating,
      reviewedAtClient,
      reviewEventId,
      clientEventId,
    );

    const reviewEventOutboxRecord: PersistedOutboxRecord = {
      operationId: reviewEventId,
      workspaceId: activeWorkspaceId,
      createdAt: reviewedAtClient,
      attemptCount: 0,
      lastError: "",
      operation: buildReviewEventAppendOperation(nextReviewEvent),
    };

    const cardOutboxRecord: PersistedOutboxRecord = {
      operationId: cardOperationId,
      workspaceId: activeWorkspaceId,
      createdAt: reviewedAtClient,
      attemptCount: 0,
      lastError: "",
      operation: buildCardUpsertOperation(nextCard),
    };

    await putReviewEvent(nextReviewEvent);
    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(reviewEventOutboxRecord);
    await putOutboxRecord(cardOutboxRecord);
    bumpLocalReadVersion();
    void runSyncForWorkspace(activeWorkspace);
    return nextCard;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace]);

  return {
    runSync,
    runSyncForWorkspace,
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
  };
}
