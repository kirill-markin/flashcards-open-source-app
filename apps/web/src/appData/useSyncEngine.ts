import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { isAuthRedirectError, pullSyncChanges, pushSyncOperations } from "../api";
import { getStableDeviceId, webAppVersion } from "../clientIdentity";
import {
  deleteOutboxRecord,
  listOutboxRecords,
  loadCardById,
  loadCloudSettings,
  loadDeckById,
  loadLocalSnapshot,
  loadWorkspaceSettings,
  putCard,
  putCloudSettings,
  putDeck,
  putOutboxRecord,
  putReviewEvent,
  putWorkspaceSettings,
  setLastAppliedChangeId,
  type PersistedOutboxRecord,
} from "../syncStorage";
import type {
  Card,
  CloudSettings,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  SessionInfo,
  SyncChange,
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
import type { MutableSnapshot, SessionLoadState } from "./types";

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
  refreshLocalData: () => Promise<void>;
  loadLocalSnapshot: () => Promise<MutableSnapshot>;
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

async function requireCard(cardId: string): Promise<Card> {
  const card = await loadCardById(cardId);
  if (card === null) {
    throw new Error(`Card not found: ${cardId}`);
  }

  return card;
}

async function requireDeck(deckId: string): Promise<Deck> {
  const deck = await loadDeckById(deckId);
  if (deck === null) {
    throw new Error(`Deck not found: ${deckId}`);
  }

  return deck;
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
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const needsResyncRef = useRef<boolean>(false);

  const bumpLocalReadVersion = useCallback(function bumpLocalReadVersion(): void {
    setLocalReadVersion((currentValue) => currentValue + 1);
  }, [setLocalReadVersion]);

  const refreshLocalMetadata = useCallback(async function refreshLocalMetadata(): Promise<void> {
    const [workspaceSettings, cloudSettings] = await Promise.all([
      loadWorkspaceSettings(),
      loadCloudSettings(),
    ]);
    setWorkspaceSettings(workspaceSettings);
    setCloudSettings(cloudSettings);
  }, [setCloudSettings, setWorkspaceSettings]);

  const applySyncChange = useCallback(async function applySyncChange(change: SyncChange): Promise<void> {
    if (change.entityType === "card") {
      await putCard(change.payload);
      bumpLocalReadVersion();
      return;
    }

    if (change.entityType === "deck") {
      await putDeck(change.payload);
      bumpLocalReadVersion();
      return;
    }

    if (change.entityType === "workspace_scheduler_settings") {
      await putWorkspaceSettings(change.payload);
      setWorkspaceSettings(change.payload);
      return;
    }

    await putReviewEvent(change.payload);
    bumpLocalReadVersion();
  }, [bumpLocalReadVersion, setWorkspaceSettings]);

  const runSync = useCallback(async function runSync(): Promise<void> {
    if (session === null || activeWorkspace === null) {
      return;
    }

    const workspaceId = activeWorkspace.workspaceId;
    const activeSync = syncPromiseRef.current;
    if (activeSync !== null) {
      needsResyncRef.current = true;
      return activeSync;
    }

    const deviceId = getStableDeviceId();
    const syncTask = (async (): Promise<void> => {
      setIsSyncing(true);
      try {
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
                await deleteOutboxRecord(result.operationId);
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

        const localSnapshot = await loadLocalSnapshot();
        let afterChangeId = localSnapshot.lastAppliedChangeId;
        while (true) {
          const pullResult = await pullSyncChanges(
            workspaceId,
            deviceId,
            "web",
            webAppVersion,
            afterChangeId,
            syncPageSize,
          );
          for (const change of pullResult.changes) {
            await applySyncChange(change);
          }

          afterChangeId = pullResult.nextChangeId;
          await setLastAppliedChangeId(workspaceId, afterChangeId);

          if (pullResult.hasMore === false) {
            break;
          }
        }

        await refreshLocalMetadata();
        setErrorMessage("");
      } catch (error) {
        if (isAuthRedirectError(error)) {
          throw error;
        }

        setErrorMessage(getErrorMessage(error));
        throw error;
      } finally {
        syncPromiseRef.current = null;
        setIsSyncing(false);

        if (needsResyncRef.current) {
          needsResyncRef.current = false;
          void runSync();
        }
      }
    })();

    syncPromiseRef.current = syncTask;
    return syncTask;
  }, [
    activeWorkspace,
    applySyncChange,
    refreshLocalMetadata,
    session,
    setErrorMessage,
    setIsSyncing,
  ]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || session === null) {
      return;
    }

    void refreshLocalMetadata();
    void runSync();
  }, [refreshLocalMetadata, runSync, session, sessionLoadState]);

  const refreshLocalData = useCallback(async function refreshLocalData(): Promise<void> {
    await refreshLocalMetadata();
    bumpLocalReadVersion();
    await runSync();
  }, [bumpLocalReadVersion, refreshLocalMetadata, runSync]);

  const getCardById = useCallback(async function getCardById(cardId: string): Promise<Card> {
    return requireCard(cardId);
  }, []);

  const getDeckById = useCallback(async function getDeckById(deckId: string): Promise<Deck> {
    return requireDeck(deckId);
  }, []);

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const normalizedInput = normalizeCreateCardInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextCard = buildInitialCard(normalizedInput, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, bumpLocalReadVersion, runSync]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const normalizedInput = normalizeCreateDeckInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
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
    void runSync();
    return nextDeck;
  }, [activeWorkspaceId, bumpLocalReadVersion, runSync]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingCard = await requireCard(cardId);
    const normalizedInput = normalizeUpdateCardInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextCard = buildUpdatedCard(existingCard, normalizedInput, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, bumpLocalReadVersion, runSync]);

  const updateDeckItem = useCallback(async function updateDeckItem(deckId: string, input: UpdateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingDeck = await requireDeck(deckId);
    const normalizedInput = normalizeUpdateDeckInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
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
    void runSync();
    return nextDeck;
  }, [activeWorkspaceId, bumpLocalReadVersion, runSync]);

  const deleteCardItem = useCallback(async function deleteCardItem(cardId: string): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingCard = await requireCard(cardId);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextCard = buildDeletedCard(existingCard, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, bumpLocalReadVersion, runSync]);

  const deleteDeckItem = useCallback(async function deleteDeckItem(deckId: string): Promise<Deck> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingDeck = await requireDeck(deckId);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
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
    void runSync();
    return nextDeck;
  }, [activeWorkspaceId, bumpLocalReadVersion, runSync]);

  const submitReviewItem = useCallback(async function submitReviewItem(
    cardId: string,
    rating: 0 | 1 | 2 | 3,
  ): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const [existingCard, schedulerSettings] = await Promise.all([
      requireCard(cardId),
      loadWorkspaceSettings(),
    ]);
    if (schedulerSettings === null) {
      throw new Error("Workspace scheduler settings are not loaded");
    }

    const reviewedAtClient = nowIso();
    const reviewEventId = crypto.randomUUID().toLowerCase();
    const clientEventId = crypto.randomUUID().toLowerCase();
    const cardOperationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
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
    await putCard(nextCard);
    await putOutboxRecord(reviewEventOutboxRecord);
    await putOutboxRecord(cardOutboxRecord);
    bumpLocalReadVersion();
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, bumpLocalReadVersion, runSync]);

  return {
    runSync,
    refreshLocalData,
    loadLocalSnapshot: async (): Promise<MutableSnapshot> => {
      const snapshot = await loadLocalSnapshot();
      return {
        cards: [...snapshot.cards],
        decks: [...snapshot.decks],
        reviewEvents: [...snapshot.reviewEvents],
        workspaceSettings: snapshot.workspaceSettings,
        cloudSettings: snapshot.cloudSettings,
        outbox: [...snapshot.outbox],
        lastAppliedChangeId: snapshot.lastAppliedChangeId,
      };
    },
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
