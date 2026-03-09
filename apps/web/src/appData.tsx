import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { ApiError, buildLoginUrl, getSession, pullSyncChanges, pushSyncOperations } from "./api";
import { getStableDeviceId, webAppVersion } from "./clientIdentity";
import {
  ensureWorkspaceCache,
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
} from "./syncStorage";
import type {
  Card,
  CreateCardInput,
  CreateDeckInput,
  Deck,
  ReviewEvent,
  SessionInfo,
  SyncChange,
  SyncPushOperation,
  UpdateCardInput,
  WorkspaceSchedulerSettings,
} from "./types";
import {
  computeReviewSchedule,
  type ReviewRating,
  type ReviewableCardScheduleState,
} from "../../backend/src/schedule";

type SessionLoadState = "loading" | "ready" | "redirecting" | "error";
type ResourceLoadStatus = "idle" | "loading" | "ready" | "error";

export type ResourceState<Item> = Readonly<{
  status: ResourceLoadStatus;
  items: ReadonlyArray<Item>;
  errorMessage: string;
  hasLoaded: boolean;
}>;

type AppDataContextValue = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionErrorMessage: string;
  session: SessionInfo | null;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  cardsState: ResourceState<Card>;
  decksState: ResourceState<Deck>;
  reviewQueueState: ResourceState<Card>;
  cards: ReadonlyArray<Card>;
  decks: ReadonlyArray<Deck>;
  reviewQueue: ReadonlyArray<Card>;
  errorMessage: string;
  setErrorMessage: (message: string) => void;
  initialize: () => Promise<void>;
  ensureCardsLoaded: () => Promise<void>;
  ensureDecksLoaded: () => Promise<void>;
  ensureReviewQueueLoaded: () => Promise<void>;
  refreshCards: () => Promise<void>;
  refreshDecks: () => Promise<void>;
  refreshReviewQueue: () => Promise<void>;
  getCardById: (cardId: string) => Promise<Card>;
  createCardItem: (input: CreateCardInput) => Promise<Card>;
  createDeckItem: (input: CreateDeckInput) => Promise<Deck>;
  updateCardItem: (cardId: string, input: UpdateCardInput) => Promise<Card>;
  submitReviewItem: (cardId: string, rating: 0 | 1 | 2 | 3) => Promise<Card>;
}>;

type MutableSnapshot = {
  cards: Array<Card>;
  decks: Array<Deck>;
  reviewEvents: Array<ReviewEvent>;
  workspaceSettings: WorkspaceSchedulerSettings | null;
  outbox: Array<PersistedOutboxRecord>;
  lastAppliedChangeId: number;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

const syncPageSize = 200;

function createIdleResourceState<Item>(): ResourceState<Item> {
  return {
    status: "idle",
    items: [],
    errorMessage: "",
    hasLoaded: false,
  };
}

function createLoadingResourceState<Item>(currentState: ResourceState<Item>): ResourceState<Item> {
  return {
    status: "loading",
    items: currentState.items,
    errorMessage: "",
    hasLoaded: currentState.hasLoaded,
  };
}

function createReadyResourceState<Item>(items: ReadonlyArray<Item>): ResourceState<Item> {
  return {
    status: "ready",
    items,
    errorMessage: "",
    hasLoaded: true,
  };
}

function createErrorResourceState<Item>(currentState: ResourceState<Item>, errorMessage: string): ResourceState<Item> {
  return {
    status: "error",
    items: currentState.items,
    errorMessage,
    hasLoaded: currentState.hasLoaded,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isCardDue(card: Card, nowTimestamp: number): boolean {
  if (card.deletedAt !== null) {
    return false;
  }

  if (card.dueAt === null) {
    return true;
  }

  return new Date(card.dueAt).getTime() <= nowTimestamp || card.fsrsCardState === "new";
}

function deriveActiveCards(cards: ReadonlyArray<Card>): ReadonlyArray<Card> {
  return cards.filter((card) => card.deletedAt === null);
}

function deriveActiveDecks(decks: ReadonlyArray<Deck>): ReadonlyArray<Deck> {
  return decks.filter((deck) => deck.deletedAt === null);
}

function deriveReviewQueue(cards: ReadonlyArray<Card>): ReadonlyArray<Card> {
  const nowTimestamp = Date.now();
  return cards
    .filter((card) => isCardDue(card, nowTimestamp))
    .sort((leftCard, rightCard) => new Date(rightCard.updatedAt).getTime() - new Date(leftCard.updatedAt).getTime());
}

function compareLww(
  left: Readonly<{
    clientUpdatedAt: string;
    lastModifiedByDeviceId: string;
    lastOperationId: string;
  }>,
  right: Readonly<{
    clientUpdatedAt: string;
    lastModifiedByDeviceId: string;
    lastOperationId: string;
  }>,
): number {
  const timestampDifference = left.clientUpdatedAt.localeCompare(right.clientUpdatedAt);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  const deviceDifference = left.lastModifiedByDeviceId.localeCompare(right.lastModifiedByDeviceId);
  if (deviceDifference !== 0) {
    return deviceDifference;
  }

  return left.lastOperationId.localeCompare(right.lastOperationId);
}

function upsertCard(cards: ReadonlyArray<Card>, nextCard: Card): Array<Card> {
  const nextCards = cards.filter((card) => card.cardId !== nextCard.cardId);
  return [nextCard, ...nextCards];
}

function upsertDeck(decks: ReadonlyArray<Deck>, nextDeck: Deck): Array<Deck> {
  const nextDecks = decks.filter((deck) => deck.deckId !== nextDeck.deckId);
  return [nextDeck, ...nextDecks];
}

function upsertReviewEvent(reviewEvents: ReadonlyArray<ReviewEvent>, nextReviewEvent: ReviewEvent): Array<ReviewEvent> {
  const nextReviewEvents = reviewEvents.filter((reviewEvent) => reviewEvent.reviewEventId !== nextReviewEvent.reviewEventId);
  return [nextReviewEvent, ...nextReviewEvents];
}

function buildInitialCard(
  input: CreateCardInput,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Card {
  return {
    cardId: crypto.randomUUID().toLowerCase(),
    frontText: input.frontText,
    backText: input.backText,
    tags: input.tags,
    effortLevel: input.effortLevel,
    dueAt: null,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

function buildUpdatedCard(
  card: Card,
  input: UpdateCardInput,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Card {
  return {
    ...card,
    frontText: input.frontText ?? card.frontText,
    backText: input.backText ?? card.backText,
    tags: input.tags ?? card.tags,
    effortLevel: input.effortLevel ?? card.effortLevel,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
  };
}

function buildDeck(
  input: CreateDeckInput,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Deck {
  return {
    deckId: crypto.randomUUID().toLowerCase(),
    workspaceId: "",
    name: input.name,
    filterDefinition: input.filterDefinition,
    createdAt: clientUpdatedAt,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: null,
  };
}

function toReviewableCardState(card: Card): ReviewableCardScheduleState {
  return {
    cardId: card.cardId,
    reps: card.reps,
    lapses: card.lapses,
    fsrsCardState: card.fsrsCardState,
    fsrsStepIndex: card.fsrsStepIndex,
    fsrsStability: card.fsrsStability,
    fsrsDifficulty: card.fsrsDifficulty,
    fsrsLastReviewedAt: card.fsrsLastReviewedAt === null ? null : new Date(card.fsrsLastReviewedAt),
    fsrsScheduledDays: card.fsrsScheduledDays,
  };
}

function buildCardUpsertOperation(card: Card): SyncPushOperation {
  return {
    operationId: card.lastOperationId,
    entityType: "card",
    entityId: card.cardId,
    action: "upsert",
    clientUpdatedAt: card.clientUpdatedAt,
    payload: {
      cardId: card.cardId,
      frontText: card.frontText,
      backText: card.backText,
      tags: card.tags,
      effortLevel: card.effortLevel,
      dueAt: card.dueAt,
      reps: card.reps,
      lapses: card.lapses,
      fsrsCardState: card.fsrsCardState,
      fsrsStepIndex: card.fsrsStepIndex,
      fsrsStability: card.fsrsStability,
      fsrsDifficulty: card.fsrsDifficulty,
      fsrsLastReviewedAt: card.fsrsLastReviewedAt,
      fsrsScheduledDays: card.fsrsScheduledDays,
      deletedAt: card.deletedAt,
    },
  };
}

function buildDeckUpsertOperation(deck: Deck): SyncPushOperation {
  return {
    operationId: deck.lastOperationId,
    entityType: "deck",
    entityId: deck.deckId,
    action: "upsert",
    clientUpdatedAt: deck.clientUpdatedAt,
    payload: {
      deckId: deck.deckId,
      name: deck.name,
      filterDefinition: deck.filterDefinition,
      createdAt: deck.createdAt,
      deletedAt: deck.deletedAt,
    },
  };
}

function buildReviewEventAppendOperation(reviewEvent: ReviewEvent): SyncPushOperation {
  return {
    operationId: reviewEvent.reviewEventId,
    entityType: "review_event",
    entityId: reviewEvent.reviewEventId,
    action: "append",
    clientUpdatedAt: reviewEvent.reviewedAtClient,
    payload: {
      reviewEventId: reviewEvent.reviewEventId,
      cardId: reviewEvent.cardId,
      deviceId: reviewEvent.deviceId,
      clientEventId: reviewEvent.clientEventId,
      rating: reviewEvent.rating,
      reviewedAtClient: reviewEvent.reviewedAtClient,
    },
  };
}

type Props = Readonly<{
  children: ReactNode;
}>;

export function AppDataProvider(props: Props): ReactElement {
  const { children } = props;
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>("loading");
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string>("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [cardsState, setCardsState] = useState<ResourceState<Card>>(createIdleResourceState<Card>());
  const [decksState, setDecksState] = useState<ResourceState<Deck>>(createIdleResourceState<Deck>());
  const [reviewQueueState, setReviewQueueState] = useState<ResourceState<Card>>(createIdleResourceState<Card>());
  const [errorMessage, setErrorMessage] = useState<string>("");
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

  const cards = cardsState.items;
  const decks = decksState.items;
  const reviewQueue = reviewQueueState.items;

  const publishSnapshot = useCallback(function publishSnapshot(snapshot: MutableSnapshot): void {
    snapshotRef.current = snapshot;
    const activeCards = deriveActiveCards(snapshot.cards);
    const activeDecks = deriveActiveDecks(snapshot.decks);
    setCardsState(createReadyResourceState(activeCards));
    setDecksState(createReadyResourceState(activeDecks));
    setReviewQueueState(createReadyResourceState(deriveReviewQueue(activeCards)));
  }, []);

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
    if (session === null) {
      return;
    }

    const workspaceId = session.workspaceId;

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
          const pullResult = await pullSyncChanges(deviceId, "web", webAppVersion, afterChangeId, syncPageSize);
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
  }, [applySyncChange, session]);

  const initialize = useCallback(async function initialize(): Promise<void> {
    setSessionLoadState("loading");
    setSessionErrorMessage("");
    setErrorMessage("");
    setCardsState((currentState) => createLoadingResourceState(currentState));
    setDecksState((currentState) => createLoadingResourceState(currentState));
    setReviewQueueState((currentState) => createLoadingResourceState(currentState));

    try {
      const currentSession = await getSession();
      setSession(currentSession);
      await ensureWorkspaceCache(currentSession.workspaceId);
      await hydrateCache();
      setSessionLoadState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) {
        setSessionLoadState("redirecting");
        window.location.href = buildLoginUrl();
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      setSessionLoadState("error");
      setSessionErrorMessage(nextErrorMessage);
      setCardsState((currentState) => createErrorResourceState(currentState, nextErrorMessage));
      setDecksState((currentState) => createErrorResourceState(currentState, nextErrorMessage));
      setReviewQueueState((currentState) => createErrorResourceState(currentState, nextErrorMessage));
    }
  }, [hydrateCache]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || session === null) {
      return;
    }

    void runSync();
  }, [runSync, session, sessionLoadState]);

  useEffect(() => {
    if (sessionLoadState !== "ready") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }, 60_000);

    const handleFocus = (): void => {
      void runSync();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [runSync, sessionLoadState]);

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
      setCardsState((currentState) => createErrorResourceState(currentState, getErrorMessage(error)));
    }
  }, [publishSnapshot, runSync]);

  const refreshDecks = useCallback(async function refreshDecks(): Promise<void> {
    setDecksState((currentState) => createLoadingResourceState(currentState));
    try {
      await runSync();
      publishSnapshot(snapshotRef.current);
    } catch (error) {
      setDecksState((currentState) => createErrorResourceState(currentState, getErrorMessage(error)));
    }
  }, [publishSnapshot, runSync]);

  const refreshReviewQueue = useCallback(async function refreshReviewQueue(): Promise<void> {
    setReviewQueueState((currentState) => createLoadingResourceState(currentState));
    try {
      await runSync();
      publishSnapshot(snapshotRef.current);
    } catch (error) {
      setReviewQueueState((currentState) => createErrorResourceState(currentState, getErrorMessage(error)));
    }
  }, [publishSnapshot, runSync]);

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

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextCard = buildInitialCard(input, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: session?.workspaceId ?? "",
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
  }, [publishSnapshot, runSync, session?.workspaceId]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextDeck = {
      ...buildDeck(input, clientUpdatedAt, deviceId, operationId),
      workspaceId: session?.workspaceId ?? "",
    };
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: session?.workspaceId ?? "",
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
  }, [publishSnapshot, runSync, session?.workspaceId]);

  const updateCardItem = useCallback(async function updateCardItem(cardId: string, input: UpdateCardInput): Promise<Card> {
    const existingCard = snapshotRef.current.cards.find((card) => card.cardId === cardId && card.deletedAt === null);
    if (existingCard === undefined) {
      throw new Error("Card not found");
    }

    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextCard = buildUpdatedCard(existingCard, input, clientUpdatedAt, deviceId, operationId);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: session?.workspaceId ?? "",
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
  }, [publishSnapshot, runSync, session?.workspaceId]);

  const submitReviewItem = useCallback(async function submitReviewItem(cardId: string, rating: 0 | 1 | 2 | 3): Promise<Card> {
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

    const nextCard: Card = {
      ...existingCard,
      dueAt: schedule.dueAt.toISOString(),
      reps: schedule.reps,
      lapses: schedule.lapses,
      fsrsCardState: schedule.fsrsCardState,
      fsrsStepIndex: schedule.fsrsStepIndex,
      fsrsStability: schedule.fsrsStability,
      fsrsDifficulty: schedule.fsrsDifficulty,
      fsrsLastReviewedAt: schedule.fsrsLastReviewedAt.toISOString(),
      fsrsScheduledDays: schedule.fsrsScheduledDays,
      clientUpdatedAt: reviewedAtClient,
      lastModifiedByDeviceId: deviceId,
      lastOperationId: cardOperationId,
      updatedAt: reviewedAtClient,
    };

    const nextReviewEvent: ReviewEvent = {
      reviewEventId,
      workspaceId: session?.workspaceId ?? "",
      cardId,
      deviceId,
      clientEventId,
      rating,
      reviewedAtClient,
      reviewedAtServer: reviewedAtClient,
    };

    const reviewEventOutboxRecord: PersistedOutboxRecord = {
      operationId: reviewEventId,
      workspaceId: session?.workspaceId ?? "",
      createdAt: reviewedAtClient,
      attemptCount: 0,
      lastError: "",
      operation: buildReviewEventAppendOperation(nextReviewEvent),
    };

    const cardOutboxRecord: PersistedOutboxRecord = {
      operationId: cardOperationId,
      workspaceId: session?.workspaceId ?? "",
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
  }, [publishSnapshot, runSync, session?.workspaceId]);

  const value: AppDataContextValue = {
    sessionLoadState,
    sessionErrorMessage,
    session,
    workspaceSettings: snapshotRef.current.workspaceSettings,
    cardsState,
    decksState,
    reviewQueueState,
    cards,
    decks,
    reviewQueue,
    errorMessage,
    setErrorMessage,
    initialize,
    ensureCardsLoaded,
    ensureDecksLoaded,
    ensureReviewQueueLoaded,
    refreshCards,
    refreshDecks,
    refreshReviewQueue,
    getCardById,
    createCardItem,
    createDeckItem,
    updateCardItem,
    submitReviewItem,
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
