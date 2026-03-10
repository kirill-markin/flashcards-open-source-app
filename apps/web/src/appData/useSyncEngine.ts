import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { isAuthRedirectError, pullSyncChanges, pushSyncOperations } from "../api";
import { getStableDeviceId, webAppVersion } from "../clientIdentity";
import {
  deleteOutboxRecord,
  listOutboxRecords,
  loadWebSyncCache,
  putCard,
  putDeck,
  putOutboxRecord,
  putReviewEvent,
  putWorkspaceSettings,
  setLastAppliedChangeId,
  type PersistedOutboxRecord,
} from "../syncStorage";
import type {
  Card,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  SessionInfo,
  SyncChange,
  UpdateCardInput,
  UpdateDeckInput,
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
  compareLww,
  deriveActiveCards,
  deriveActiveDecks,
  deriveReviewQueue,
  getErrorMessage,
  normalizeCreateCardInput,
  normalizeCreateDeckInput,
  normalizeUpdateCardInput,
  normalizeUpdateDeckInput,
  nowIso,
  toReviewableCardState,
  upsertCard,
  upsertDeck,
  upsertReviewEvent,
} from "./domain";
import {
  createErrorResourceState,
  createLoadingResourceState,
  createReadyResourceState,
} from "./resourceState";
import type {
  MutableSnapshot,
  ResourceState,
  SessionLoadState,
} from "./types";

const syncPageSize = 200;

type UseSyncEngineParams = Readonly<{
  sessionLoadState: SessionLoadState;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  cardsState: ResourceState<Card>;
  decksState: ResourceState<Deck>;
  reviewQueueState: ResourceState<Card>;
  setCardsState: Dispatch<SetStateAction<ResourceState<Card>>>;
  setDecksState: Dispatch<SetStateAction<ResourceState<Deck>>>;
  setReviewQueueState: Dispatch<SetStateAction<ResourceState<Card>>>;
  setErrorMessage: Dispatch<SetStateAction<string>>;
}>;

type SyncEngine = Readonly<{
  snapshotRef: MutableRefObject<MutableSnapshot>;
  hydrateCache: () => Promise<void>;
  runSync: () => Promise<void>;
  ensureCardsLoaded: () => Promise<void>;
  ensureDecksLoaded: () => Promise<void>;
  ensureReviewQueueLoaded: () => Promise<void>;
  refreshCards: () => Promise<void>;
  refreshDecks: () => Promise<void>;
  refreshReviewQueue: () => Promise<void>;
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

export function useSyncEngine(params: UseSyncEngineParams): SyncEngine {
  const {
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
  } = params;
  const snapshotRef = useRef<MutableSnapshot>({
    cards: [],
    decks: [],
    reviewEvents: [],
    workspaceSettings: null,
    outbox: [],
    lastAppliedChangeId: 0,
  });
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const needsResyncRef = useRef<boolean>(false);

  const publishSnapshot = useCallback(function publishSnapshot(snapshot: MutableSnapshot): void {
    snapshotRef.current = snapshot;
    const activeCards = deriveActiveCards(snapshot.cards);
    const activeDecks = deriveActiveDecks(snapshot.decks);
    setCardsState(createReadyResourceState(activeCards));
    setDecksState(createReadyResourceState(activeDecks));
    setReviewQueueState(createReadyResourceState(deriveReviewQueue(activeCards)));
  }, [setCardsState, setDecksState, setReviewQueueState]);

  const hydrateCache = useCallback(async function hydrateCache(): Promise<void> {
    const cache = await loadWebSyncCache();
    publishSnapshot({
      cards: [...cache.cards],
      decks: [...cache.decks],
      reviewEvents: [...cache.reviewEvents],
      workspaceSettings: cache.workspaceSettings,
      outbox: [...cache.outbox],
      lastAppliedChangeId: cache.lastAppliedChangeId,
    });
  }, [publishSnapshot]);

  const applySyncChange = useCallback(async function applySyncChange(change: SyncChange): Promise<void> {
    const currentSnapshot = snapshotRef.current;

    if (change.entityType === "card") {
      const existingCard = currentSnapshot.cards.find((card) => card.cardId === change.entityId);
      if (
        existingCard === undefined
        || compareLww(
          {
            clientUpdatedAt: existingCard.clientUpdatedAt,
            lastModifiedByDeviceId: existingCard.lastModifiedByDeviceId,
            lastOperationId: existingCard.lastOperationId,
          },
          {
            clientUpdatedAt: change.payload.clientUpdatedAt,
            lastModifiedByDeviceId: change.payload.lastModifiedByDeviceId,
            lastOperationId: change.payload.lastOperationId,
          },
        ) <= 0
      ) {
        await putCard(change.payload);
        publishSnapshot({
          ...currentSnapshot,
          cards: upsertCard(currentSnapshot.cards, change.payload),
        });
      }
      return;
    }

    if (change.entityType === "deck") {
      const existingDeck = currentSnapshot.decks.find((deck) => deck.deckId === change.entityId);
      if (
        existingDeck === undefined
        || compareLww(
          {
            clientUpdatedAt: existingDeck.clientUpdatedAt,
            lastModifiedByDeviceId: existingDeck.lastModifiedByDeviceId,
            lastOperationId: existingDeck.lastOperationId,
          },
          {
            clientUpdatedAt: change.payload.clientUpdatedAt,
            lastModifiedByDeviceId: change.payload.lastModifiedByDeviceId,
            lastOperationId: change.payload.lastOperationId,
          },
        ) <= 0
      ) {
        await putDeck(change.payload);
        publishSnapshot({
          ...currentSnapshot,
          decks: upsertDeck(currentSnapshot.decks, change.payload),
        });
      }
      return;
    }

    if (change.entityType === "workspace_scheduler_settings") {
      const existingSettings = currentSnapshot.workspaceSettings;
      if (
        existingSettings === null
        || compareLww(
          {
            clientUpdatedAt: existingSettings.clientUpdatedAt,
            lastModifiedByDeviceId: existingSettings.lastModifiedByDeviceId,
            lastOperationId: existingSettings.lastOperationId,
          },
          {
            clientUpdatedAt: change.payload.clientUpdatedAt,
            lastModifiedByDeviceId: change.payload.lastModifiedByDeviceId,
            lastOperationId: change.payload.lastOperationId,
          },
        ) <= 0
      ) {
        await putWorkspaceSettings(change.payload);
        publishSnapshot({
          ...currentSnapshot,
          workspaceSettings: change.payload,
        });
      }
      return;
    }

    const existingReviewEvent = currentSnapshot.reviewEvents.find((reviewEvent) => reviewEvent.reviewEventId === change.entityId);
    if (existingReviewEvent === undefined) {
      await putReviewEvent(change.payload);
      publishSnapshot({
        ...currentSnapshot,
        reviewEvents: upsertReviewEvent(currentSnapshot.reviewEvents, change.payload),
      });
    }
  }, [publishSnapshot]);

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
      try {
        const initialOutbox = await listOutboxRecords(workspaceId);
        snapshotRef.current = {
          ...snapshotRef.current,
          outbox: [...initialOutbox],
        };

        while (snapshotRef.current.outbox.length > 0) {
          const batch = snapshotRef.current.outbox.slice(0, 100);
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

          const nextOutbox = await listOutboxRecords(workspaceId);
          snapshotRef.current = {
            ...snapshotRef.current,
            outbox: [...nextOutbox],
          };
        }

        let afterChangeId = snapshotRef.current.lastAppliedChangeId;
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
          snapshotRef.current = {
            ...snapshotRef.current,
            lastAppliedChangeId: afterChangeId,
          };
          await setLastAppliedChangeId(workspaceId, afterChangeId);

          if (pullResult.hasMore === false) {
            break;
          }
        }

        setErrorMessage("");
      } catch (error) {
        if (isAuthRedirectError(error)) {
          throw error;
        }

        setErrorMessage(getErrorMessage(error));
        throw error;
      } finally {
        syncPromiseRef.current = null;

        if (needsResyncRef.current) {
          needsResyncRef.current = false;
          void runSync();
        }
      }
    })();

    syncPromiseRef.current = syncTask;
    return syncTask;
  }, [activeWorkspace, applySyncChange, session, setErrorMessage]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || session === null) {
      return;
    }

    void runSync();
  }, [runSync, session, sessionLoadState]);

  const ensureCardsLoaded = useCallback(async function ensureCardsLoaded(): Promise<void> {
    if (cardsState.hasLoaded === false) {
      await hydrateCache();
    }
  }, [cardsState.hasLoaded, hydrateCache]);

  const ensureDecksLoaded = useCallback(async function ensureDecksLoaded(): Promise<void> {
    if (decksState.hasLoaded === false) {
      await hydrateCache();
    }
  }, [decksState.hasLoaded, hydrateCache]);

  const ensureReviewQueueLoaded = useCallback(async function ensureReviewQueueLoaded(): Promise<void> {
    if (reviewQueueState.hasLoaded === false) {
      await hydrateCache();
    }
  }, [hydrateCache, reviewQueueState.hasLoaded]);

  const refreshCards = useCallback(async function refreshCards(): Promise<void> {
    setCardsState((currentState) => createLoadingResourceState(currentState));
    try {
      await runSync();
      publishSnapshot(snapshotRef.current);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      setCardsState((currentState) => createErrorResourceState(currentState, getErrorMessage(error)));
    }
  }, [publishSnapshot, runSync, setCardsState]);

  const refreshDecks = useCallback(async function refreshDecks(): Promise<void> {
    setDecksState((currentState) => createLoadingResourceState(currentState));
    try {
      await runSync();
      publishSnapshot(snapshotRef.current);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      setDecksState((currentState) => createErrorResourceState(currentState, getErrorMessage(error)));
    }
  }, [publishSnapshot, runSync, setDecksState]);

  const refreshReviewQueue = useCallback(async function refreshReviewQueue(): Promise<void> {
    setReviewQueueState((currentState) => createLoadingResourceState(currentState));
    try {
      await runSync();
      publishSnapshot(snapshotRef.current);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      setReviewQueueState((currentState) => createErrorResourceState(currentState, getErrorMessage(error)));
    }
  }, [publishSnapshot, runSync, setReviewQueueState]);

  const getCardById = useCallback(async function getCardById(cardId: string): Promise<Card> {
    const existingCard = snapshotRef.current.cards.find((card) => card.cardId === cardId && card.deletedAt === null);
    if (existingCard !== undefined) {
      return existingCard;
    }

    await runSync();
    const syncedCard = snapshotRef.current.cards.find((card) => card.cardId === cardId && card.deletedAt === null);
    if (syncedCard === undefined) {
      throw new Error(`Card not found: ${cardId}`);
    }

    return syncedCard;
  }, [runSync]);

  const getDeckById = useCallback(async function getDeckById(deckId: string): Promise<Deck> {
    const existingDeck = snapshotRef.current.decks.find((deck) => deck.deckId === deckId && deck.deletedAt === null);
    if (existingDeck !== undefined) {
      return existingDeck;
    }

    await runSync();
    const syncedDeck = snapshotRef.current.decks.find((deck) => deck.deckId === deckId && deck.deletedAt === null);
    if (syncedDeck === undefined) {
      throw new Error(`Deck not found: ${deckId}`);
    }

    return syncedDeck;
  }, [runSync]);

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
    publishSnapshot({
      ...snapshotRef.current,
      cards: upsertCard(snapshotRef.current.cards, nextCard),
      outbox: [...snapshotRef.current.outbox, nextOutboxRecord],
    });
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, publishSnapshot, runSync]);

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
    publishSnapshot({
      ...snapshotRef.current,
      decks: upsertDeck(snapshotRef.current.decks, nextDeck),
      outbox: [...snapshotRef.current.outbox, nextOutboxRecord],
    });
    void runSync();
    return nextDeck;
  }, [activeWorkspaceId, publishSnapshot, runSync]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingCard = snapshotRef.current.cards.find((card) => card.cardId === cardId && card.deletedAt === null);
    if (existingCard === undefined) {
      throw new Error("Card not found");
    }

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
    publishSnapshot({
      ...snapshotRef.current,
      cards: upsertCard(snapshotRef.current.cards, nextCard),
      outbox: [...snapshotRef.current.outbox, nextOutboxRecord],
    });
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, publishSnapshot, runSync]);

  const updateDeckItem = useCallback(async function updateDeckItem(deckId: string, input: UpdateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingDeck = snapshotRef.current.decks.find((deck) => deck.deckId === deckId && deck.deletedAt === null);
    if (existingDeck === undefined) {
      throw new Error("Deck not found");
    }

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
    publishSnapshot({
      ...snapshotRef.current,
      decks: upsertDeck(snapshotRef.current.decks, nextDeck),
      outbox: [...snapshotRef.current.outbox, nextOutboxRecord],
    });
    void runSync();
    return nextDeck;
  }, [activeWorkspaceId, publishSnapshot, runSync]);

  const deleteCardItem = useCallback(async function deleteCardItem(cardId: string): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingCard = snapshotRef.current.cards.find((card) => card.cardId === cardId && card.deletedAt === null);
    if (existingCard === undefined) {
      throw new Error("Card not found");
    }

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
    publishSnapshot({
      ...snapshotRef.current,
      cards: upsertCard(snapshotRef.current.cards, nextCard),
      outbox: [...snapshotRef.current.outbox, nextOutboxRecord],
    });
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, publishSnapshot, runSync]);

  const deleteDeckItem = useCallback(async function deleteDeckItem(deckId: string): Promise<Deck> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingDeck = snapshotRef.current.decks.find((deck) => deck.deckId === deckId && deck.deletedAt === null);
    if (existingDeck === undefined) {
      throw new Error("Deck not found");
    }

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
    publishSnapshot({
      ...snapshotRef.current,
      decks: upsertDeck(snapshotRef.current.decks, nextDeck),
      outbox: [...snapshotRef.current.outbox, nextOutboxRecord],
    });
    void runSync();
    return nextDeck;
  }, [activeWorkspaceId, publishSnapshot, runSync]);

  const submitReviewItem = useCallback(async function submitReviewItem(
    cardId: string,
    rating: 0 | 1 | 2 | 3,
  ): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const existingCard = snapshotRef.current.cards.find((card) => card.cardId === cardId && card.deletedAt === null);
    if (existingCard === undefined) {
      throw new Error("Card not found");
    }

    const schedulerSettings = snapshotRef.current.workspaceSettings;
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
    publishSnapshot({
      ...snapshotRef.current,
      cards: upsertCard(snapshotRef.current.cards, nextCard),
      reviewEvents: upsertReviewEvent(snapshotRef.current.reviewEvents, nextReviewEvent),
      outbox: [...snapshotRef.current.outbox, reviewEventOutboxRecord, cardOutboxRecord],
    });
    void runSync();
    return nextCard;
  }, [activeWorkspaceId, publishSnapshot, runSync]);

  return {
    snapshotRef,
    hydrateCache,
    runSync,
    ensureCardsLoaded,
    ensureDecksLoaded,
    ensureReviewQueueLoaded,
    refreshCards,
    refreshDecks,
    refreshReviewQueue,
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
