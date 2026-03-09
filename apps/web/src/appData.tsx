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
import {
  createWorkspace as createWorkspaceRequest,
  getSession,
  isAuthRedirectError,
  listWorkspaces,
  pullSyncChanges,
  pushSyncOperations,
  revalidateSession as revalidateSessionRequest,
  selectWorkspace,
} from "./api";
import { getStableDeviceId, webAppVersion } from "./clientIdentity";
import {
  clearWebSyncCache,
  relinkWorkspaceCache,
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
  WorkspaceSummary,
  WorkspaceSchedulerSettings,
} from "./types";
import {
  computeReviewSchedule,
  type ReviewRating,
  type ReviewableCardScheduleState,
} from "../../backend/src/schedule";

type SessionLoadState = "loading" | "ready" | "redirecting" | "selecting_workspace" | "error";
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
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  isChoosingWorkspace: boolean;
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
  chooseWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
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
  deleteCardItem: (cardId: string) => Promise<Card>;
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
const defaultWorkspaceName = "My Flashcards";

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

function consumeLoggedOutMarker(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("logged_out") !== "1") {
    return false;
  }

  url.searchParams.delete("logged_out");
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, nextUrl);
  return true;
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

function markSelectedWorkspaces(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  selectedWorkspaceId: string,
): Array<WorkspaceSummary> {
  return workspaces.map((workspace) => ({
    ...workspace,
    isSelected: workspace.workspaceId === selectedWorkspaceId,
  }));
}

function upsertWorkspaceSummary(
  workspaces: ReadonlyArray<WorkspaceSummary>,
  workspace: WorkspaceSummary,
): Array<WorkspaceSummary> {
  return [...workspaces.filter((item) => item.workspaceId !== workspace.workspaceId), workspace];
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

function buildDeletedCard(
  card: Card,
  clientUpdatedAt: string,
  deviceId: string,
  operationId: string,
): Card {
  return {
    ...card,
    clientUpdatedAt,
    lastModifiedByDeviceId: deviceId,
    lastOperationId: operationId,
    updatedAt: clientUpdatedAt,
    deletedAt: clientUpdatedAt,
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
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(null);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>([]);
  const [isChoosingWorkspace, setIsChoosingWorkspace] = useState<boolean>(false);
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

  const activateWorkspace = useCallback(async function activateWorkspace(
    currentSession: SessionInfo,
    currentWorkspaces: ReadonlyArray<WorkspaceSummary>,
    workspace: WorkspaceSummary,
  ): Promise<void> {
    await relinkWorkspaceCache(workspace.workspaceId);
    await hydrateCache();

    const nextWorkspaces = markSelectedWorkspaces(currentWorkspaces, workspace.workspaceId);
    setAvailableWorkspaces(nextWorkspaces);
    setActiveWorkspace({
      ...workspace,
      isSelected: true,
    });
    setSession({
      ...currentSession,
      selectedWorkspaceId: workspace.workspaceId,
    });
    setSessionLoadState("ready");
    setSessionErrorMessage("");
    setErrorMessage("");
  }, [hydrateCache]);

  const resolveInitialWorkspace = useCallback(async function resolveInitialWorkspace(
    currentSession: SessionInfo,
  ): Promise<void> {
    const workspaces = await listWorkspaces();

    if (workspaces.length === 0) {
      // The web app does not persist a local workspace name, so use the same
      // predictable default label for the first explicit remote workspace.
      const createdWorkspace = await createWorkspaceRequest(defaultWorkspaceName);
      await activateWorkspace(currentSession, [createdWorkspace], createdWorkspace);
      return;
    }

    if (workspaces.length === 1) {
      const onlyWorkspace = workspaces[0];
      const selectedWorkspace = currentSession.selectedWorkspaceId === onlyWorkspace.workspaceId
        ? onlyWorkspace
        : await selectWorkspace(onlyWorkspace.workspaceId);
      await activateWorkspace(currentSession, [selectedWorkspace], selectedWorkspace);
      return;
    }

    setAvailableWorkspaces(workspaces);
    setActiveWorkspace(null);
    setSession(currentSession);
    setSessionLoadState("selecting_workspace");
  }, [activateWorkspace]);

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
  }, [activeWorkspace, applySyncChange, session]);

  const initialize = useCallback(async function initialize(): Promise<void> {
    setSessionLoadState("loading");
    setSessionErrorMessage("");
    setErrorMessage("");
    setActiveWorkspace(null);
    setAvailableWorkspaces([]);
    setCardsState((currentState) => createLoadingResourceState(currentState));
    setDecksState((currentState) => createLoadingResourceState(currentState));
    setReviewQueueState((currentState) => createLoadingResourceState(currentState));

    try {
      if (consumeLoggedOutMarker()) {
        await clearWebSyncCache();
      }

      const currentSession = await getSession();
      await resolveInitialWorkspace(currentSession);
    } catch (error) {
      if (isAuthRedirectError(error)) {
        setSessionLoadState("redirecting");
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      setSessionLoadState("error");
      setSessionErrorMessage(nextErrorMessage);
      setCardsState((currentState) => createErrorResourceState(currentState, nextErrorMessage));
      setDecksState((currentState) => createErrorResourceState(currentState, nextErrorMessage));
      setReviewQueueState((currentState) => createErrorResourceState(currentState, nextErrorMessage));
    }
  }, [resolveInitialWorkspace]);

  const chooseWorkspace = useCallback(async function chooseWorkspace(workspaceId: string): Promise<void> {
    if (session === null) {
      throw new Error("Session is unavailable");
    }

    setIsChoosingWorkspace(true);
    try {
      const selectedWorkspace = await selectWorkspace(workspaceId);
      await activateWorkspace(session, availableWorkspaces, selectedWorkspace);
      setErrorMessage("");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [activateWorkspace, availableWorkspaces, session]);

  const createWorkspace = useCallback(async function createWorkspace(name: string): Promise<void> {
    if (session === null) {
      throw new Error("Session is unavailable");
    }

    const trimmedName = name.trim();
    if (trimmedName === "") {
      throw new Error("Workspace name is required");
    }

    setIsChoosingWorkspace(true);
    try {
      const createdWorkspace = await createWorkspaceRequest(trimmedName);
      const nextWorkspaces = upsertWorkspaceSummary(availableWorkspaces, createdWorkspace);
      await activateWorkspace(session, nextWorkspaces, createdWorkspace);
      setErrorMessage("");
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return;
      }

      const nextErrorMessage = getErrorMessage(error);
      setErrorMessage(nextErrorMessage);
      throw error;
    } finally {
      setIsChoosingWorkspace(false);
    }
  }, [activateWorkspace, availableWorkspaces, session]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || session === null) {
      return;
    }

    void runSync();
  }, [runSync, session, sessionLoadState]);

  /**
   * Revalidates the browser session when the tab resumes so background sync
   * never keeps using an expired cookie/CSRF pair after a long idle period.
   */
  const revalidateActiveSession = useCallback(async function revalidateActiveSession(): Promise<boolean> {
    if (sessionLoadState !== "ready") {
      return false;
    }

    try {
      const currentSession = await revalidateSessionRequest();
      setSession(currentSession);
      setSessionErrorMessage("");
      setErrorMessage("");
      return true;
    } catch (error) {
      if (isAuthRedirectError(error)) {
        return false;
      }

      setErrorMessage(getErrorMessage(error));
      throw error;
    }
  }, [sessionLoadState]);

  useEffect(() => {
    if (sessionLoadState !== "ready" || session === null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }, 60_000);

    const handleResume = (): void => {
      void (async (): Promise<void> => {
        const isSessionValid = await revalidateActiveSession();
        if (isSessionValid) {
          await runSync();
        }
      })();
    };

    const handleFocus = (): void => {
      handleResume();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        handleResume();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [revalidateActiveSession, runSync, session, sessionLoadState]);

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
  }, [publishSnapshot, runSync]);

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
  }, [publishSnapshot, runSync]);

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

  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextCard = buildInitialCard(input, clientUpdatedAt, deviceId, operationId);
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

    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextDeck = {
      ...buildDeck(input, clientUpdatedAt, deviceId, operationId),
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

    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const deviceId = getStableDeviceId();
    const nextCard = buildUpdatedCard(existingCard, input, clientUpdatedAt, deviceId, operationId);
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

  const submitReviewItem = useCallback(async function submitReviewItem(cardId: string, rating: 0 | 1 | 2 | 3): Promise<Card> {
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
      workspaceId: activeWorkspaceId,
      cardId,
      deviceId,
      clientEventId,
      rating,
      reviewedAtClient,
      reviewedAtServer: reviewedAtClient,
    };

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

  const value: AppDataContextValue = {
    sessionLoadState,
    sessionErrorMessage,
    session,
    activeWorkspace,
    availableWorkspaces,
    isChoosingWorkspace,
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
    chooseWorkspace,
    createWorkspace,
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
    deleteCardItem,
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
