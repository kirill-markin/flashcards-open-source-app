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
  SessionInfo,
  SyncBootstrapEntry,
  SyncPushResult,
  UpdateCardInput,
  UpdateDeckInput,
  WorkspaceSchedulerSettings,
  WorkspaceSummary,
} from "../types";
// Keep local web review scheduling aligned with the backend source of truth and
// the mirrored native copies:
// - apps/backend/src/schedule.ts
// - apps/ios/Flashcards/Flashcards/FsrsScheduler.swift
// - apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/model/FsrsScheduler.kt
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
  doesCardMutationAffectReviewSchedule,
  getErrorMessage,
  normalizeCreateCardInput,
  normalizeCreateDeckInput,
  normalizeUpdateCardInput,
  normalizeUpdateDeckInput,
  nowIso,
  toReviewableCardState,
} from "./domain";
import {
  invalidateLocalProgress,
  invalidateLocalReviewSchedule,
  invalidateProgress,
} from "./progress/progressInvalidation";
import type { TestSeedCardInput, TestSeedRequest, TestSeedResult } from "./testSeedBridge";
import type { SessionLoadState } from "./types";
import type { SessionVerificationState } from "./warmStart";

const syncPageSize = 200;

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

function requireCloudInstallationId(cloudSettings: CloudSettings | null): string {
  if (cloudSettings === null) {
    throw new Error("Cloud settings are not loaded");
  }

  if (cloudSettings.installationId.trim() === "") {
    throw new Error("Cloud settings installationId is not loaded");
  }

  return cloudSettings.installationId;
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

function isProgressReviewEventOperation(
  record: PersistedOutboxRecord,
): boolean {
  return record.operation.entityType === "review_event" && record.operation.action === "append";
}

function isProgressReviewScheduleCardOperation(
  record: PersistedOutboxRecord,
): boolean {
  return record.operation.entityType === "card"
    && record.operation.action === "upsert"
    && (record.affectsReviewSchedule ?? true);
}

function isAcknowledgedPushStatus(status: SyncPushResult["operations"][number]["status"]): boolean {
  return status === "applied" || status === "ignored" || status === "duplicate";
}

async function doHotSyncEntriesAffectReviewSchedule(
  workspaceId: string,
  entries: ReadonlyArray<SyncBootstrapEntry>,
): Promise<boolean> {
  for (const entry of entries) {
    if (entry.entityType !== "card") {
      continue;
    }

    const existingCard = await loadCardById(workspaceId, entry.payload.cardId);
    if (doesCardMutationAffectReviewSchedule(existingCard, entry.payload)) {
      return true;
    }
  }

  return false;
}

function requireSeedTimestamp(label: string, value: string): number {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${label} must be a valid ISO timestamp: ${value}`);
  }

  return timestamp;
}

function validateSeedCardInput(card: TestSeedCardInput, cardIndex: number): void {
  const createdAtTimestamp = requireSeedTimestamp(`Seed card ${cardIndex} createdAt`, card.createdAt);
  let previousTimestamp = createdAtTimestamp;

  for (const [reviewIndex, review] of card.reviews.entries()) {
    const currentTimestamp = requireSeedTimestamp(
      `Seed card ${cardIndex} review ${reviewIndex} reviewedAtClient`,
      review.reviewedAtClient,
    );

    if (currentTimestamp <= previousTimestamp) {
      throw new Error(
        `Seed card ${cardIndex} review ${reviewIndex} reviewedAtClient must be later than the previous mutation timestamp`,
      );
    }

    previousTimestamp = currentTimestamp;
  }
}

function validateSeedRequest(request: TestSeedRequest): void {
  for (const [cardIndex, card] of request.cards.entries()) {
    validateSeedCardInput(card, cardIndex);
  }
}

type WorkspaceSeedReadiness = Readonly<{
  workspaceSettingsLoaded: boolean;
  hotStateHydrated: boolean;
  reviewHistoryHydrated: boolean;
}>;

function isWorkspaceSeedReady(readiness: WorkspaceSeedReadiness): boolean {
  return readiness.workspaceSettingsLoaded && readiness.hotStateHydrated && readiness.reviewHistoryHydrated;
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

  const loadWorkspaceSeedReadiness = useCallback(async function loadWorkspaceSeedReadiness(
    workspaceId: string,
  ): Promise<WorkspaceSeedReadiness> {
    const [workspaceSettings, hotStateHydrated, reviewHistoryHydrated] = await Promise.all([
      loadWorkspaceSettings(workspaceId),
      hasHydratedHotState(workspaceId),
      hasHydratedReviewHistory(workspaceId),
    ]);

    return {
      workspaceSettingsLoaded: workspaceSettings !== null,
      hotStateHydrated,
      reviewHistoryHydrated,
    };
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
    const activeSync = syncPromisesRef.current.get(workspaceId);
    if (activeSync !== undefined) {
      needsResyncWorkspaceIdsRef.current.add(workspaceId);
      return activeSync;
    }

    syncingWorkspaceIdsRef.current.add(workspaceId);
    refreshSyncIndicator();

    const syncTask = (async (): Promise<void> => {
      try {
        let didChangeProgressHistory = false;
        let didChangeReviewSchedule = false;
        const cloudSettings = await loadCloudSettings();
        const installationId = requireCloudInstallationId(cloudSettings);
        const hotStateHydrated = await hasHydratedHotState(workspaceId);
        if (hotStateHydrated === false) {
          let bootstrapCursor: string | null = null;

          while (true) {
            const bootstrapResult = await bootstrapPullSyncState(
              workspaceId,
              installationId,
              "web",
              webAppVersion,
              bootstrapCursor,
              syncPageSize,
            );

            if (await doHotSyncEntriesAffectReviewSchedule(workspaceId, bootstrapResult.entries)) {
              didChangeReviewSchedule = true;
            }

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
          const batchIncludesProgressReviewEvents = batch.some(isProgressReviewEventOperation);
          const reviewScheduleOperationIds = new Set(
            batch
              .filter(isProgressReviewScheduleCardOperation)
              .map((record) => record.operationId),
          );
          try {
            const pushResult = await pushSyncOperations(
              workspaceId,
              installationId,
              "web",
              webAppVersion,
              batch.map((record) => record.operation),
            );

            for (const result of pushResult.operations) {
              if (isAcknowledgedPushStatus(result.status)) {
                await deleteOutboxRecord(workspaceId, result.operationId);
                if (reviewScheduleOperationIds.has(result.operationId)) {
                  didChangeReviewSchedule = true;
                }
              }
            }

            if (batchIncludesProgressReviewEvents) {
              didChangeProgressHistory = true;
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
            installationId,
            "web",
            webAppVersion,
            afterHotChangeId,
            syncPageSize,
          );

          if (await doHotSyncEntriesAffectReviewSchedule(workspaceId, pullResult.changes)) {
            didChangeReviewSchedule = true;
          }

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
            installationId,
            "web",
            webAppVersion,
            afterReviewSequenceId,
            syncPageSize,
          );

          await applyReviewHistorySyncPage(workspaceId, reviewHistoryResult.reviewEvents, {
            lastAppliedReviewSequenceId: reviewHistoryResult.nextReviewSequenceId,
            markReviewHistoryHydrated: reviewHistoryHydrated === false && reviewHistoryResult.hasMore === false,
          });

          if (reviewHistoryResult.reviewEvents.length > 0) {
            didChangeProgressHistory = true;
          }

          afterReviewSequenceId = reviewHistoryResult.nextReviewSequenceId;

          if (reviewHistoryResult.hasMore === false) {
            break;
          }
        }

        await refreshWorkspaceView(workspaceId);
        if (didChangeProgressHistory) {
          invalidateProgress();
        }
        if (didChangeReviewSchedule) {
          invalidateLocalReviewSchedule();
        }
        setErrorMessage("");
      } catch (error) {
        if (isAuthRedirectError(error)) {
          throw error;
        }

        reportSyncError(getErrorMessage(error));
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
    reportGlobalSyncError,
    session,
    sessionVerificationState,
    setWorkspaceSettings,
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

  const ensureWorkspaceSeedReady = useCallback(async function ensureWorkspaceSeedReady(
    workspace: WorkspaceSummary,
  ): Promise<void> {
    const workspaceId = workspace.workspaceId;

    await waitForWorkspaceSyncToSettle(workspaceId);

    let readiness = await loadWorkspaceSeedReadiness(workspaceId);
    if (isWorkspaceSeedReady(readiness)) {
      await refreshWorkspaceView(workspaceId);
      return;
    }

    await runSyncForWorkspace(workspace);
    await waitForWorkspaceSyncToSettle(workspaceId);
    await refreshWorkspaceView(workspaceId);

    readiness = await loadWorkspaceSeedReadiness(workspaceId);
    if (isWorkspaceSeedReady(readiness)) {
      return;
    }

    throw new Error(
      `Workspace bootstrap is not ready for deterministic seed data: `
      + `workspaceId=${workspaceId} `
      + `workspaceSettingsLoaded=${String(readiness.workspaceSettingsLoaded)} `
      + `hotStateHydrated=${String(readiness.hotStateHydrated)} `
      + `reviewHistoryHydrated=${String(readiness.reviewHistoryHydrated)}`,
    );
  }, [
    loadWorkspaceSeedReadiness,
    refreshWorkspaceView,
    runSyncForWorkspace,
    waitForWorkspaceSyncToSettle,
  ]);

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

  const createCardItemLocally = useCallback(async function createCardItemLocally(
    input: CreateCardInput,
    clientUpdatedAt: string,
  ): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const normalizedInput = normalizeCreateCardInput(input);
    const operationId = crypto.randomUUID().toLowerCase();
    const installationId = requireCloudInstallationId(await loadCloudSettings());
    const nextCard = buildInitialCard(normalizedInput, clientUpdatedAt, installationId, operationId);
    const affectsReviewSchedule = doesCardMutationAffectReviewSchedule(null, nextCard);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      affectsReviewSchedule,
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(nextOutboxRecord);
    return nextCard;
  }, [activeWorkspaceId]);

  const submitReviewItemLocally = useCallback(async function submitReviewItemLocally(
    cardId: string,
    rating: 0 | 1 | 2 | 3,
    reviewedAtClient: string,
  ): Promise<Card> {
    if (activeWorkspaceId === null) {
      throw new Error("Workspace is unavailable");
    }

    const [existingCard, schedulerSettings, cloudSettings] = await Promise.all([
      requireCard(activeWorkspaceId, cardId),
      loadWorkspaceSettings(activeWorkspaceId),
      loadCloudSettings(),
    ]);
    if (schedulerSettings === null) {
      throw new Error("Workspace scheduler settings are not loaded");
    }

    const reviewEventId = crypto.randomUUID().toLowerCase();
    const clientEventId = crypto.randomUUID().toLowerCase();
    const cardOperationId = crypto.randomUUID().toLowerCase();
    const installationId = requireCloudInstallationId(cloudSettings);
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

    const nextCard = buildReviewedCard(existingCard, schedule, reviewedAtClient, installationId, cardOperationId);
    const nextReviewEvent = buildReviewEvent(
      activeWorkspaceId,
      cardId,
      installationId,
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
      affectsReviewSchedule: doesCardMutationAffectReviewSchedule(existingCard, nextCard),
      operation: buildCardUpsertOperation(nextCard),
    };

    await putReviewEvent(nextReviewEvent);
    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(reviewEventOutboxRecord);
    await putOutboxRecord(cardOutboxRecord);
    return nextCard;
  }, [activeWorkspaceId]);

  const createCardItem = useCallback(async function createCardItem(input: CreateCardInput): Promise<Card> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const nextCard = await createCardItemLocally(input, nowIso());
    bumpLocalReadVersion();
    invalidateLocalReviewSchedule();
    void runSyncForWorkspace(activeWorkspace);
    return nextCard;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, createCardItemLocally, runSyncForWorkspace]);

  const createDeckItem = useCallback(async function createDeckItem(input: CreateDeckInput): Promise<Deck> {
    if (activeWorkspaceId === null || activeWorkspace === null) {
      throw new Error("Workspace is unavailable");
    }

    const normalizedInput = normalizeCreateDeckInput(input);
    const clientUpdatedAt = nowIso();
    const operationId = crypto.randomUUID().toLowerCase();
    const installationId = requireCloudInstallationId(await loadCloudSettings());
    const nextDeck = {
      ...buildDeck(normalizedInput, clientUpdatedAt, installationId, operationId),
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
    const installationId = requireCloudInstallationId(await loadCloudSettings());
    const nextCard = buildUpdatedCard(existingCard, normalizedInput, clientUpdatedAt, installationId, operationId);
    const affectsReviewSchedule = doesCardMutationAffectReviewSchedule(existingCard, nextCard);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      affectsReviewSchedule,
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    if (affectsReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
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
    const installationId = requireCloudInstallationId(await loadCloudSettings());
    const nextDeck = buildUpdatedDeck(existingDeck, normalizedInput, clientUpdatedAt, installationId, operationId);
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
    const installationId = requireCloudInstallationId(await loadCloudSettings());
    const nextCard = buildDeletedCard(existingCard, clientUpdatedAt, installationId, operationId);
    const affectsReviewSchedule = doesCardMutationAffectReviewSchedule(existingCard, nextCard);
    const nextOutboxRecord: PersistedOutboxRecord = {
      operationId,
      workspaceId: activeWorkspaceId,
      createdAt: clientUpdatedAt,
      attemptCount: 0,
      lastError: "",
      affectsReviewSchedule,
      operation: buildCardUpsertOperation(nextCard),
    };

    await putCard(activeWorkspaceId, nextCard);
    await putOutboxRecord(nextOutboxRecord);
    bumpLocalReadVersion();
    if (affectsReviewSchedule) {
      invalidateLocalReviewSchedule();
    }
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
    const installationId = requireCloudInstallationId(await loadCloudSettings());
    const nextDeck = buildDeletedDeck(existingDeck, clientUpdatedAt, installationId, operationId);
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

    const nextCard = await submitReviewItemLocally(cardId, rating, nowIso());
    bumpLocalReadVersion();
    invalidateLocalProgress();
    invalidateLocalReviewSchedule();
    void runSyncForWorkspace(activeWorkspace);
    return nextCard;
  }, [activeWorkspace, activeWorkspaceId, bumpLocalReadVersion, runSyncForWorkspace, submitReviewItemLocally]);

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
    await ensureWorkspaceSeedReady(activeWorkspace);

    const seededCards: Array<TestSeedResult["cards"][number]> = [];
    let didChangeProgressHistory = false;

    for (const seedCard of request.cards) {
      let nextCard = await createCardItemLocally(seedCard, seedCard.createdAt);

      for (const review of seedCard.reviews) {
        nextCard = await submitReviewItemLocally(nextCard.cardId, review.rating, review.reviewedAtClient);
        didChangeProgressHistory = true;
      }

      seededCards.push({
        cardId: nextCard.cardId,
        frontText: nextCard.frontText,
        createdAt: seedCard.createdAt,
        dueAt: nextCard.dueAt,
        reviewsApplied: seedCard.reviews.length,
      });
    }

    bumpLocalReadVersion();
    if (request.cards.length > 0) {
      invalidateLocalReviewSchedule();
    }
    if (didChangeProgressHistory) {
      invalidateLocalProgress();
    }

    await runSyncForWorkspace(activeWorkspace);
    await waitForWorkspaceSyncToSettle(activeWorkspaceId);

    return {
      workspaceId: activeWorkspaceId,
      cards: seededCards,
    };
  }, [
    activeWorkspace,
    activeWorkspaceId,
    bumpLocalReadVersion,
    createCardItemLocally,
    runSyncForWorkspace,
    session,
    sessionLoadState,
    sessionVerificationState,
    ensureWorkspaceSeedReady,
    submitReviewItemLocally,
  ]);

  return {
    runSync,
    runSyncSilently,
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
    seedLinkedWorkspace,
  };
}
