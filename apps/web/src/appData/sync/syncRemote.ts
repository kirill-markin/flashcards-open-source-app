import {
  bootstrapPullSyncState,
  pullReviewHistorySync,
  pullSyncChanges,
  pushSyncOperations,
} from "../../api";
import { webAppVersion } from "../../clientIdentity";
import { loadActiveCardCount, loadCardsByIds } from "../../localDb/cards/cards";
import {
  ensurePersistentStorage,
  readPersistentStorageState,
  type PersistentStorageState,
} from "../../localDb/sync/cloudSettings";
import {
  deleteOutboxRecord,
  isScheduleRelevantCardOutboxRecord,
  listOutboxRecords,
  putOutboxRecord,
  type PersistedOutboxRecord,
} from "../../localDb/sync/outbox";
import {
  applyHotSyncPage,
  applyReviewHistorySyncPage,
  hasHydratedReviewHistory,
  loadLastAppliedHotChangeId,
  loadLastAppliedReviewSequenceId,
  loadWorkspaceSyncState,
} from "../../localDb/cards/workspace";
import type { SyncRestoreLocalBootstrapState } from "../../observability/webObservability";
import type {
  SyncBootstrapEntry,
  SyncChange,
  SyncPushResult,
  WorkspaceSchedulerSettings,
} from "../../types";
import {
  doesCardMutationAffectReviewSchedule,
  getErrorMessage,
} from "../domain";
import {
  observeLocalDbMissing,
  observePersistentStorageState,
  observeSlowHotBootstrap,
} from "./syncLifecycleObservation";
import {
  loadSyncRestoreHistoryEntry,
  storeSyncRestoreHistoryEntry,
  type SyncRestoreHistoryEntry,
} from "./syncRestoreHistory";

const syncPageSize = 500;
const slowHotBootstrapWarningThresholdMs = 2000;

type HotSyncEntry = SyncBootstrapEntry | SyncChange;
type CardHotSyncEntry = Extract<HotSyncEntry, Readonly<{ entityType: "card" }>>;

export type RemoteSyncFlags = Readonly<{
  didChangeProgressHistory: boolean;
  didChangeReviewSchedule: boolean;
}>;

export type WorkspaceRemoteSyncInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  requireWorkspaceSyncNotDiscarded: (workspaceId: string) => void;
  publishWorkspaceSettings: (workspaceId: string, settings: WorkspaceSchedulerSettings) => void;
  refreshWorkspaceView: (workspaceId: string) => Promise<void>;
}>;

function createEmptyRemoteSyncFlags(): RemoteSyncFlags {
  return {
    didChangeProgressHistory: false,
    didChangeReviewSchedule: false,
  };
}

function mergeRemoteSyncFlags(leftFlags: RemoteSyncFlags, rightFlags: RemoteSyncFlags): RemoteSyncFlags {
  return {
    didChangeProgressHistory: leftFlags.didChangeProgressHistory || rightFlags.didChangeProgressHistory,
    didChangeReviewSchedule: leftFlags.didChangeReviewSchedule || rightFlags.didChangeReviewSchedule,
  };
}

function findLastWorkspaceSettingsEntry(
  entries: ReadonlyArray<HotSyncEntry>,
): WorkspaceSchedulerSettings | null {
  let lastSettings: WorkspaceSchedulerSettings | null = null;

  for (const entry of entries) {
    if (entry.entityType === "workspace_scheduler_settings") {
      lastSettings = entry.payload;
    }
  }

  return lastSettings;
}

function publishWorkspaceSettingsFromEntries(
  input: WorkspaceRemoteSyncInput,
  entries: ReadonlyArray<HotSyncEntry>,
): void {
  const lastSettings = findLastWorkspaceSettingsEntry(entries);
  if (lastSettings !== null) {
    input.publishWorkspaceSettings(input.workspaceId, lastSettings);
  }
}

function isProgressReviewEventOperation(
  record: PersistedOutboxRecord,
): boolean {
  return record.operation.entityType === "review_event" && record.operation.action === "append";
}

function isAcknowledgedPushStatus(status: SyncPushResult["operations"][number]["status"]): boolean {
  return status === "applied" || status === "ignored" || status === "duplicate";
}

function isCardHotSyncEntry(entry: HotSyncEntry): entry is CardHotSyncEntry {
  return entry.entityType === "card";
}

function isEmptyRemoteBootstrapNoise(
  remoteIsEmpty: boolean | null,
  entriesCount: number,
  localCardCountAfter: number,
): boolean {
  return remoteIsEmpty === true && localCardCountAfter === 0 && entriesCount <= 1;
}

function shouldObserveHotBootstrap(input: Readonly<{
  durationMs: number;
  pageCount: number;
  entriesCount: number;
  localCardCountAfter: number;
  remoteIsEmpty: boolean | null;
}>): boolean {
  if (isEmptyRemoteBootstrapNoise(input.remoteIsEmpty, input.entriesCount, input.localCardCountAfter)) {
    return false;
  }

  return input.durationMs >= slowHotBootstrapWarningThresholdMs || input.pageCount > 1;
}

function determineLocalBootstrapState(
  syncStateBefore: Awaited<ReturnType<typeof loadWorkspaceSyncState>>,
  localCardCountBefore: number,
): SyncRestoreLocalBootstrapState {
  if (syncStateBefore === null) {
    return localCardCountBefore === 0 ? "no_sync_state_no_cards" : "no_sync_state_with_cards";
  }

  return localCardCountBefore === 0 ? "unhydrated_sync_state" : "unhydrated_with_cards";
}

function loadWorkspaceRestoreHistory(input: WorkspaceRemoteSyncInput): SyncRestoreHistoryEntry | null {
  return loadSyncRestoreHistoryEntry({
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
  });
}

async function storeCurrentWorkspaceRestoreHistory(
  input: WorkspaceRemoteSyncInput,
  lastAppliedHotChangeId: number,
): Promise<void> {
  const localCardCount = await loadActiveCardCount(input.workspaceId);
  storeSyncRestoreHistoryEntry({
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    lastAppliedHotChangeId,
    localCardCount,
  });
}

async function observePersistentStorageForHydratedWorkspace(
  input: WorkspaceRemoteSyncInput,
): Promise<PersistentStorageState> {
  const persistentStorageState = await ensurePersistentStorage();
  observePersistentStorageState({
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    persistentStorageState,
  });
  return persistentStorageState;
}

async function backfillRestoreHistoryForHydratedState(
  input: WorkspaceRemoteSyncInput,
  syncStateBefore: NonNullable<Awaited<ReturnType<typeof loadWorkspaceSyncState>>>,
): Promise<void> {
  const restoreHistory = loadWorkspaceRestoreHistory(input);
  if (restoreHistory !== null) {
    return;
  }

  await storeCurrentWorkspaceRestoreHistory(input, syncStateBefore.lastAppliedHotChangeId);
}

async function doHotSyncEntriesAffectReviewSchedule(
  workspaceId: string,
  entries: ReadonlyArray<HotSyncEntry>,
): Promise<boolean> {
  const cardEntries = entries.filter(isCardHotSyncEntry);
  if (cardEntries.length === 0) {
    return false;
  }

  const existingCards = await loadCardsByIds(
    workspaceId,
    cardEntries.map((entry) => entry.payload.cardId),
  );

  return cardEntries.some((entry) => doesCardMutationAffectReviewSchedule(
    existingCards.get(entry.payload.cardId) ?? null,
    entry.payload,
  ));
}

async function bootstrapHotState(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  const syncStateBefore = await loadWorkspaceSyncState(input.workspaceId);
  const hotStateHydrated = syncStateBefore?.hasHydratedHotState ?? false;
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  if (hotStateHydrated) {
    if (syncStateBefore === null) {
      throw new Error(`Workspace ${input.workspaceId} hot state is hydrated without sync state`);
    }

    await backfillRestoreHistoryForHydratedState(input, syncStateBefore);
    await observePersistentStorageForHydratedWorkspace(input);
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    return createEmptyRemoteSyncFlags();
  }

  const startedAtMs = Date.now();
  const localCardCountBefore = await loadActiveCardCount(input.workspaceId);
  const localBootstrapState = determineLocalBootstrapState(syncStateBefore, localCardCountBefore);
  const restoreHistoryBefore = loadWorkspaceRestoreHistory(input);
  let didChangeReviewSchedule = false;
  let bootstrapCursor: string | null = null;
  let pageCount = 0;
  let entriesCount = 0;
  let nextHotChangeId: number | null = null;
  let remoteIsEmpty: boolean | null = null;

  if (syncStateBefore === null && localCardCountBefore === 0 && restoreHistoryBefore !== null) {
    const persistentStorageStateBeforeMissingWarning = await readPersistentStorageState();
    observeLocalDbMissing({
      userId: input.userId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      localBootstrapState,
      localCardCountBefore,
      previousRestoreHistory: restoreHistoryBefore,
      currentWebAppVersion: webAppVersion,
      persistentStorageState: persistentStorageStateBeforeMissingWarning,
    });
  }

  while (true) {
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const bootstrapResult = await bootstrapPullSyncState(
      input.workspaceId,
      input.installationId,
      "web",
      webAppVersion,
      bootstrapCursor,
      syncPageSize,
    );
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    pageCount += 1;
    entriesCount += bootstrapResult.entries.length;
    nextHotChangeId = bootstrapResult.bootstrapHotChangeId;
    remoteIsEmpty = bootstrapResult.remoteIsEmpty;

    if (await doHotSyncEntriesAffectReviewSchedule(input.workspaceId, bootstrapResult.entries)) {
      didChangeReviewSchedule = true;
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    await applyHotSyncPage(
      input.workspaceId,
      bootstrapResult.entries,
      bootstrapResult.hasMore
        ? null
        : {
          lastAppliedHotChangeId: bootstrapResult.bootstrapHotChangeId,
          markHotStateHydrated: true,
        },
    );
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    publishWorkspaceSettingsFromEntries(input, bootstrapResult.entries);

    bootstrapCursor = bootstrapResult.nextCursor;
    if (bootstrapResult.hasMore === false) {
      break;
    }
  }

  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  await input.refreshWorkspaceView(input.workspaceId);
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  const durationMs = Date.now() - startedAtMs;
  const localCardCountAfter = await loadActiveCardCount(input.workspaceId);
  if (nextHotChangeId === null) {
    throw new Error(`Workspace ${input.workspaceId} bootstrap did not return a hot change id`);
  }

  storeSyncRestoreHistoryEntry({
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    lastAppliedHotChangeId: nextHotChangeId,
    localCardCount: localCardCountAfter,
  });
  await observePersistentStorageForHydratedWorkspace(input);
  if (shouldObserveHotBootstrap({
    durationMs,
    pageCount,
    entriesCount,
    localCardCountAfter,
    remoteIsEmpty,
  })) {
    observeSlowHotBootstrap({
      userId: input.userId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      durationMs,
      pageSize: syncPageSize,
      pageCount,
      entriesCount,
      localCardCountBefore,
      localCardCountAfter,
      localBootstrapState,
      lastAppliedHotChangeIdBefore: syncStateBefore?.lastAppliedHotChangeId ?? null,
      nextHotChangeId,
      remoteIsEmpty,
    });
  }

  return {
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

async function pushOutbox(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let currentOutbox = await listOutboxRecords(input.workspaceId);
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  let didChangeProgressHistory = false;
  let didChangeReviewSchedule = false;

  while (currentOutbox.length > 0) {
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const batch = currentOutbox.slice(0, 100);
    const batchIncludesProgressReviewEvents = batch.some(isProgressReviewEventOperation);
    const reviewScheduleOperationIds = new Set(
      batch
        .filter(isScheduleRelevantCardOutboxRecord)
        .map((record) => record.operationId),
    );
    try {
      const pushResult = await pushSyncOperations(
        input.workspaceId,
        input.installationId,
        "web",
        webAppVersion,
        batch.map((record) => record.operation),
      );
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

      for (const result of pushResult.operations) {
        if (isAcknowledgedPushStatus(result.status)) {
          input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
          await deleteOutboxRecord(input.workspaceId, result.operationId);
          if (reviewScheduleOperationIds.has(result.operationId)) {
            didChangeReviewSchedule = true;
          }
        }
      }

      if (batchIncludesProgressReviewEvents) {
        didChangeProgressHistory = true;
      }
    } catch (error) {
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      const errorMessage = getErrorMessage(error);
      for (const record of batch) {
        input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
        await putOutboxRecord({
          ...record,
          attemptCount: record.attemptCount + 1,
          lastError: errorMessage,
        });
      }
      throw error;
    }

    currentOutbox = await listOutboxRecords(input.workspaceId);
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  }

  return {
    didChangeProgressHistory,
    didChangeReviewSchedule,
  };
}

async function pullHotChanges(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let afterHotChangeId = await loadLastAppliedHotChangeId(input.workspaceId);
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  let didChangeReviewSchedule = false;

  while (true) {
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const pullResult = await pullSyncChanges(
      input.workspaceId,
      input.installationId,
      "web",
      webAppVersion,
      afterHotChangeId,
      syncPageSize,
    );
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    if (await doHotSyncEntriesAffectReviewSchedule(input.workspaceId, pullResult.changes)) {
      didChangeReviewSchedule = true;
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    await applyHotSyncPage(input.workspaceId, pullResult.changes, {
      lastAppliedHotChangeId: pullResult.nextHotChangeId,
      markHotStateHydrated: false,
    });
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    publishWorkspaceSettingsFromEntries(input, pullResult.changes);

    afterHotChangeId = pullResult.nextHotChangeId;

    if (pullResult.hasMore === false) {
      break;
    }
  }

  return {
    didChangeProgressHistory: false,
    didChangeReviewSchedule,
  };
}

async function pullReviewHistory(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let afterReviewSequenceId = await loadLastAppliedReviewSequenceId(input.workspaceId);
  const reviewHistoryHydrated = await hasHydratedReviewHistory(input.workspaceId);
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  let didChangeProgressHistory = false;

  while (true) {
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const reviewHistoryResult = await pullReviewHistorySync(
      input.workspaceId,
      input.installationId,
      "web",
      webAppVersion,
      afterReviewSequenceId,
      syncPageSize,
    );
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    await applyReviewHistorySyncPage(input.workspaceId, reviewHistoryResult.reviewEvents, {
      lastAppliedReviewSequenceId: reviewHistoryResult.nextReviewSequenceId,
      markReviewHistoryHydrated: reviewHistoryHydrated === false && reviewHistoryResult.hasMore === false,
    });
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

    if (reviewHistoryResult.reviewEvents.length > 0) {
      didChangeProgressHistory = true;
    }

    afterReviewSequenceId = reviewHistoryResult.nextReviewSequenceId;

    if (reviewHistoryResult.hasMore === false) {
      break;
    }
  }

  return {
    didChangeProgressHistory,
    didChangeReviewSchedule: false,
  };
}

export async function runWorkspaceRemoteSync(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  let syncFlags = createEmptyRemoteSyncFlags();
  syncFlags = mergeRemoteSyncFlags(syncFlags, await bootstrapHotState(input));
  syncFlags = mergeRemoteSyncFlags(syncFlags, await pushOutbox(input));
  syncFlags = mergeRemoteSyncFlags(syncFlags, await pullHotChanges(input));
  syncFlags = mergeRemoteSyncFlags(syncFlags, await pullReviewHistory(input));
  return syncFlags;
}
