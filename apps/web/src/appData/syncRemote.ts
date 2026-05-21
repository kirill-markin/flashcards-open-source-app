import {
  bootstrapPullSyncState,
  pullReviewHistorySync,
  pullSyncChanges,
  pushSyncOperations,
} from "../api";
import { webAppVersion } from "../clientIdentity";
import { loadCardsByIds } from "../localDb/cards";
import {
  deleteOutboxRecord,
  isScheduleRelevantCardOutboxRecord,
  listOutboxRecords,
  putOutboxRecord,
  type PersistedOutboxRecord,
} from "../localDb/outbox";
import {
  applyHotSyncPage,
  applyReviewHistorySyncPage,
  hasHydratedHotState,
  hasHydratedReviewHistory,
  loadLastAppliedHotChangeId,
  loadLastAppliedReviewSequenceId,
} from "../localDb/workspace";
import type {
  SyncBootstrapEntry,
  SyncChange,
  SyncPushResult,
  WorkspaceSchedulerSettings,
} from "../types";
import {
  doesCardMutationAffectReviewSchedule,
  getErrorMessage,
} from "./domain";

const syncPageSize = 200;

type HotSyncEntry = SyncBootstrapEntry | SyncChange;
type CardHotSyncEntry = Extract<HotSyncEntry, Readonly<{ entityType: "card" }>>;

export type RemoteSyncFlags = Readonly<{
  didChangeProgressHistory: boolean;
  didChangeReviewSchedule: boolean;
}>;

export type WorkspaceRemoteSyncInput = Readonly<{
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
  const hotStateHydrated = await hasHydratedHotState(input.workspaceId);
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  if (hotStateHydrated) {
    return createEmptyRemoteSyncFlags();
  }

  let didChangeReviewSchedule = false;
  let bootstrapCursor: string | null = null;

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
